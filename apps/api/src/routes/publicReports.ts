import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { fromPrisma } from "pg-boss";
import { adminPrisma } from "../adminDb";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { extractIndicators, type Indicator } from "../lib/indicators";
import { parseSubmittedUrl } from "../lib/submittedUrl";
import { parseSocialUrl } from "../lib/socialUrls";
import { recordSocialSighting } from "../pipeline/socialFindings";
import {
  PublicReportSchema,
  CONTACT_LINK_HOSTS,
  PUBLIC_REPORT_DAILY_SCAN_CAP,
  verifyTurnstile,
  type PublicReportInput,
} from "../lib/publicReports";
import { createRateLimiter } from "../lib/rateLimit";
import { boss, QUEUE_RECHECK } from "../queue/boss";
import type { RecheckJobData } from "../pipeline/recheckJob";

const perIpLimit = createRateLimiter(5, 60 * 60 * 1000);

const PatchReportSchema = z.object({ status: z.enum(["new", "reviewed", "dismissed"]) });

// A reported number may sit on a page as a plain phone number or as a WhatsApp link --
// same number, either way.
const PHONE_KINDS = ["phone", "whatsapp"];

export async function publicReportRoutes(app: FastifyInstance) {
  // ---- Public (no login): the /report/<token> form ----

  // Brand lookup by token is cross-tenant by nature (no org context exists yet) -- the
  // same narrow, id-and-name-only admin read as the queue dispatchers. Everything after
  // it runs inside withTenant.
  async function brandForToken(token: string) {
    if (!token || token.length > 100) return null;
    return adminPrisma.brand.findUnique({
      where: { reportToken: token },
      select: { id: true, name: true, organizationId: true, primaryDomain: true, domains: { select: { domain: true } } },
    });
  }

  app.get("/api/public/reports/:token", async (request, reply) => {
    const brand = await brandForToken((request.params as { token: string }).token);
    if (!brand) return reply.status(404).send({ error: "not_found" });
    return reply.send({ brandName: brand.name });
  });

  app.post("/api/public/reports/:token", async (request, reply) => {
    if (!perIpLimit(request.ip)) return reply.status(429).send({ error: "too_many_reports" });

    const parsed = PublicReportSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const input = parsed.data;
    // Bots get the same answer as people, so they don't learn to skip the field.
    if (input.website) return reply.status(201).send({ ok: true });
    if (!(await verifyTurnstile(input.turnstileToken, request.ip))) return reply.status(400).send({ error: "captcha_failed" });

    const brand = await brandForToken((request.params as { token: string }).token);
    if (!brand) return reply.status(404).send({ error: "not_found" });

    let target = null as ReturnType<typeof parseSubmittedUrl> | null;
    if (input.url) {
      target = parseSubmittedUrl(/^https?:\/\//i.test(input.url) ? input.url : `https://${input.url}`);
      if (!target.ok) return reply.status(400).send({ error: target.error });
    }

    await saveReport(brand, input, target?.ok ? target : null);
    // Same answer whether or not it matched anything: the public never learns what we know.
    return reply.status(201).send({ ok: true });
  });

  // ---- Analysts ----

  app.get("/api/reports", { preHandler: authenticate }, async (request, reply) => {
    const { status } = request.query as { status?: string };
    const reports = await withTenant(request.auth!.orgId, async (tx) => {
      const rows = await tx.publicReport.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      const ids = [...new Set(rows.flatMap((r) => [r.findingId, ...r.matchedFindingIds]).filter((x): x is string => Boolean(x)))];
      const findings = await tx.finding.findMany({ where: { id: { in: ids } }, select: { id: true, identifier: true, severity: true } });
      const byId = new Map(findings.map((f) => [f.id, f]));
      return rows.map((r) => ({
        ...r,
        finding: r.findingId ? byId.get(r.findingId) ?? null : null,
        matchedFindings: r.matchedFindingIds.map((id) => byId.get(id)).filter(Boolean),
      }));
    });
    return reply.send(reports);
  });

  app.patch(
    "/api/reports/:id",
    { preHandler: [authenticate, requireRole("owner", "admin", "analyst")] },
    async (request, reply) => {
      const parsed = PatchReportSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
      const { id } = request.params as { id: string };
      const updated = await withTenant(request.auth!.orgId, (tx) => tx.publicReport.updateMany({ where: { id }, data: { status: parsed.data.status } }));
      if (updated.count === 0) return reply.status(404).send({ error: "not_found" });
      return reply.send({ ok: true });
    }
  );

  // Create or rotate the brand's public link. Rotating kills every copy of the old one.
  app.post(
    "/api/brands/:id/report-token",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const reportToken = randomBytes(18).toString("base64url");
      const updated = await withTenant(request.auth!.orgId, (tx) => tx.brand.updateMany({ where: { id }, data: { reportToken } }));
      if (updated.count === 0) return reply.status(404).send({ error: "not_found" });
      return reply.send({ reportToken });
    }
  );

  app.delete(
    "/api/brands/:id/report-token",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const updated = await withTenant(request.auth!.orgId, (tx) => tx.brand.updateMany({ where: { id }, data: { reportToken: null } }));
      if (updated.count === 0) return reply.status(404).send({ error: "not_found" });
      return reply.status(204).send();
    }
  );
}

interface ReportBrand {
  id: string;
  organizationId: string;
  primaryDomain: string;
  domains: Array<{ domain: string }>;
}

async function saveReport(
  brand: ReportBrand,
  input: PublicReportInput,
  target: Extract<ReturnType<typeof parseSubmittedUrl>, { ok: true }> | null
): Promise<void> {
  const ownDomains = [brand.primaryDomain, ...brand.domains.map((d) => d.domain)].map((d) => d.toLowerCase());
  const isOwn = (host: string) => ownDomains.some((o) => host === o || host.endsWith(`.${o}`));
  // A wa.me link (or a t.me link that isn't a channel) is a contact handle, not a site;
  // the brand's own site isn't a scam. A Telegram channel is a social account.
  const social = target?.type === "social" ? parseSocialUrl(target.identifier) : null;
  const scannable =
    target && (social || !CONTACT_LINK_HOSTS.has(target.hostname.replace(/^www\./, ""))) && !isOwn(target.hostname) ? target : null;

  const indicators = extractIndicators(`${input.phone ?? ""}\n${input.description ?? ""}`, input.url ? [input.url] : []);

  await withTenant(brand.organizationId, async (tx) => {
    const matched = indicators.length > 0 ? await findMatchingFindings(tx, brand.id, indicators) : [];

    let findingId: string | null = null;
    let scanQueued = false;
    if (scannable) {
      const existing = await tx.finding.findUnique({ where: { brandId_identifier: { brandId: brand.id, identifier: scannable.identifier } } });
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const scansToday = await tx.publicReport.count({ where: { brandId: brand.id, scanQueued: true, createdAt: { gte: since } } });
      const underCap = scansToday < PUBLIC_REPORT_DAILY_SCAN_CAP;

      if (existing) {
        findingId = existing.id;
      } else if (underCap && social) {
        findingId = (await recordSocialSighting(tx, brand.id, "public_report", { account: social, postUrl: scannable.postUrl })).findingId;
      } else if (underCap) {
        const created = await tx.finding.create({
          data: { brandId: brand.id, type: scannable.type, identifier: scannable.identifier, source: "public_report", nextScanAt: new Date() },
        });
        findingId = created.id;
      }
      // An existing false positive isn't rescanned on a report -- it stays linked, and the
      // analyst sees the report on /reports.
      if (findingId && underCap && existing?.status !== "false_positive") {
        const data: RecheckJobData = { findingId, organizationId: brand.organizationId, triggeredBy: "manual" };
        await boss.send(QUEUE_RECHECK, data, { db: fromPrisma(tx), singletonKey: findingId });
        scanQueued = true;
      }
    }

    const report = await tx.publicReport.create({
      data: {
        brandId: brand.id,
        url: input.url || null,
        phone: input.phone || null,
        description: input.description || null,
        reporterEmail: input.reporterEmail || null,
        findingId,
        matchedFindingIds: matched.filter((id) => id !== findingId),
        scanQueued,
      },
    });

    // In-app only (the email template is finding-shaped, and email is down on Render
    // anyway -- see CLAUDE.md open issue 2).
    const rule = await tx.alertRule.findFirst({ where: { organizationId: brand.organizationId, kind: "public_report", enabled: true } });
    if (rule?.channels.includes("in_app")) {
      const what = input.url || input.phone || "a scam";
      const linked = findingId || matched.length > 0 ? "" : " (no matching finding yet)";
      await tx.notification.create({
        data: {
          organizationId: brand.organizationId,
          findingId: findingId ?? matched[0] ?? null,
          reportId: report.id,
          message: `Public report: ${what.slice(0, 120)}${linked}`,
        },
      });
    }
  });
}

async function findMatchingFindings(
  tx: Prisma.TransactionClient,
  brandId: string,
  indicators: Indicator[]
): Promise<string[]> {
  const phoneValues = indicators.filter((i) => PHONE_KINDS.includes(i.kind)).map((i) => i.value);
  const others = indicators.filter((i) => !PHONE_KINDS.includes(i.kind));
  const rows = await tx.findingIndicator.findMany({
    where: {
      brandId,
      OR: [
        ...(phoneValues.length > 0 ? [{ kind: { in: PHONE_KINDS }, value: { in: phoneValues } }] : []),
        ...others.map((i) => ({ kind: i.kind, value: i.value })),
      ],
    },
    select: { findingId: true },
  });
  return [...new Set(rows.map((r) => r.findingId))];
}
