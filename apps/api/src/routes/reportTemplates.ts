import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { recordAutomationEvent } from "../lib/takedownAutomation";
import {
  CHANNEL_KINDS,
  CHANNELS,
  defaultTemplate,
  isValidChannelKind,
  KINDS,
  LANGUAGES,
  LOCKED_BODY,
  LOCKED_SUBJECT,
  MAX_BODY,
  MAX_SUBJECT,
  PLACEHOLDERS,
  renderTemplate,
  validateTemplate,
  type Channel,
  type Kind,
  type ReportContext,
} from "../lib/reportTemplates";
import { loadReportContext, resolveTemplate } from "../lib/reportContext";
import { sendTestToSelf } from "../lib/selfTestSend";

// Report templates (TAKEDOWN_AUTOMATION_PLAN.md §5.1-5.2). Analysts edit a draft version;
// owners/admins publish it. Reports only ever use a published version (or the built-in text),
// and remember which one. Published versions are never changed, only replaced and archived.

const ANALYST_UP = ["owner", "admin", "analyst"];

const ScopeSchema = z.object({
  brandId: z.string().min(1).max(64).nullable().optional().transform((v) => v ?? null),
  channel: z.enum(CHANNELS),
  kind: z.enum(KINDS),
  language: z.enum(LANGUAGES).default("en"),
});
const TextSchema = z.object({ subject: z.string().max(MAX_SUBJECT * 2), body: z.string().max(MAX_BODY * 2) });
const DraftSchema = ScopeSchema.merge(TextSchema);
const PreviewSchema = ScopeSchema.merge(TextSchema).extend({ findingId: z.string().min(1).max(64).nullable().optional() });
const ProfileSchema = z.object({
  companyDetails: z.string().max(2000).nullable().optional(),
  disclaimer: z.string().max(2000).nullable().optional(),
});

async function actorEmail(tx: Prisma.TransactionClient, userId: string) {
  return (await tx.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? userId;
}

async function brandInOrg(tx: Prisma.TransactionClient, orgId: string, brandId: string | null) {
  if (!brandId) return true;
  return !!(await tx.brand.findFirst({ where: { id: brandId, organizationId: orgId }, select: { id: true } }));
}

function apiOrigin(request: FastifyRequest) {
  return `${request.protocol}://${request.host}`;
}

// Made-up finding for previews when the org has no website finding yet.
function sampleContext(c: Pick<ReportContext, "brand" | "org" | "signature" | "signatory">): ReportContext {
  const domain = `${c.brand.officialDomain.split(".")[0]}-customer-care.example`;
  return {
    ...c,
    finding: { url: `https://${domain}/login`, domain, firstDetectedAt: new Date(Date.now() - 2 * 86400_000) },
    registrar: { name: "Example Registrar, Inc.", ianaId: "9999" },
    registeredAt: new Date(Date.now() - 5 * 86400_000),
    nameservers: ["ns1.example-dns.net", "ns2.example-dns.net"],
    ip: "203.0.113.10",
    hostingOrg: "Example Hosting Ltd",
    lastChecked: { at: new Date(), live: true },
    reasons: [`Domain contains the brand name "${c.brand.name.toLowerCase()}"`, "Page has a login form", "Registered in the last 30 days"],
    indicators: [{ kind: "phone", value: "+254700000000" }],
    screenshotUrl: "https://brand-monitor.example/screenshots/sample.png",
    reportRef: "BM-SAMPLE00",
    previous: null,
  };
}

export async function reportTemplateRoutes(app: FastifyInstance) {
  // Every channel x kind for one scope (the org, or one brand's overrides), in one language.
  app.get("/api/report-templates", { preHandler: authenticate }, async (request, reply) => {
    const q = z
      .object({ brandId: z.string().min(1).max(64).optional(), language: z.enum(LANGUAGES).default("en") })
      .safeParse(request.query);
    if (!q.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    const brandId = q.data.brandId ?? null;
    const language = q.data.language;

    return withTenant(orgId, async (tx) => {
      if (!(await brandInOrg(tx, orgId, brandId))) return reply.status(404).send({ error: "not_found" });
      const [templates, automation, languagesUsed] = await Promise.all([
        tx.takedownTemplate.findMany({
          where: { organizationId: orgId, scopeKey: brandId ?? "org", language },
          include: { versions: { where: { status: { in: ["draft", "published"] } } } },
        }),
        tx.takedownAutomation.findUnique({ where: { organizationId: orgId }, select: { companyDetails: true, disclaimer: true } }),
        tx.takedownTemplate.findMany({ where: { organizationId: orgId }, select: { language: true }, distinct: ["language"] }),
      ]);
      const rows = [];
      for (const channel of CHANNELS) {
        for (const kind of CHANNEL_KINDS[channel]) {
          const t = templates.find((x) => x.channel === channel && x.kind === kind);
          const published = t?.versions.find((v) => v.status === "published") ?? null;
          const draft = t?.versions.find((v) => v.status === "draft") ?? null;
          // What a report for this scope uses today (falls back brand -> org -> built-in).
          const effective = await resolveTemplate(tx, orgId, brandId, channel, kind, language);
          rows.push({ channel, kind, templateId: t?.id ?? null, published, draft, effective, builtIn: defaultTemplate(channel, kind) });
        }
      }
      return {
        scope: brandId ? "brand" : "org",
        brandId,
        language,
        languages: LANGUAGES,
        languagesUsed: [...new Set(["en", ...languagesUsed.map((l) => l.language)])],
        placeholders: PLACEHOLDERS,
        locked: { subject: LOCKED_SUBJECT, body: LOCKED_BODY },
        profile: { companyDetails: automation?.companyDetails ?? null, disclaimer: automation?.disclaimer ?? null },
        templates: rows,
      };
    });
  });

  // Saves the draft version (creating the template on first save). Refused when it doesn't
  // validate, so a draft can always be published as it stands.
  app.put("/api/report-templates/draft", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const parsed = DraftSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const { brandId, channel, kind, language, subject, body } = parsed.data;
    if (!isValidChannelKind(channel, kind)) return reply.status(400).send({ error: "invalid_request" });
    const errors = validateTemplate({ subject, body }, channel);
    if (errors.length) return reply.status(400).send({ error: "invalid_template", errors });
    const orgId = request.auth!.orgId;

    return withTenant(orgId, async (tx) => {
      if (!(await brandInOrg(tx, orgId, brandId))) return reply.status(404).send({ error: "not_found" });
      const email = await actorEmail(tx, request.auth!.userId);
      const scopeKey = brandId ?? "org";
      const template = await tx.takedownTemplate.upsert({
        where: { organizationId_scopeKey_channel_kind_language: { organizationId: orgId, scopeKey, channel, kind, language } },
        create: { organizationId: orgId, brandId, scopeKey, channel, kind, language },
        update: {},
      });
      const existing = await tx.takedownTemplateVersion.findFirst({ where: { templateId: template.id, status: "draft" } });
      let draft;
      if (existing) {
        draft = await tx.takedownTemplateVersion.update({ where: { id: existing.id }, data: { subject, body, createdBy: email } });
      } else {
        const last = await tx.takedownTemplateVersion.findFirst({ where: { templateId: template.id }, orderBy: { version: "desc" }, select: { version: true } });
        draft = await tx.takedownTemplateVersion.create({
          data: { templateId: template.id, organizationId: orgId, version: (last?.version ?? 0) + 1, status: "draft", subject, body, createdBy: email },
        });
      }
      return reply.send({ templateId: template.id, draft });
    });
  });

  app.delete("/api/report-templates/:templateId/draft", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const { count } = await tx.takedownTemplateVersion.deleteMany({ where: { templateId, organizationId: orgId, status: "draft" } });
      if (count === 0) return reply.status(404).send({ error: "not_found" });
      return reply.status(204).send();
    });
  });

  app.post("/api/report-templates/:templateId/publish", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const template = await tx.takedownTemplate.findFirst({ where: { id: templateId, organizationId: orgId } });
      const draft = template ? await tx.takedownTemplateVersion.findFirst({ where: { templateId, status: "draft" } }) : null;
      if (!template || !draft) return reply.status(404).send({ error: "not_found" });
      const errors = validateTemplate(draft, template.channel as Channel);
      if (errors.length) return reply.status(400).send({ error: "invalid_template", errors });
      const email = await actorEmail(tx, request.auth!.userId);
      await tx.takedownTemplateVersion.updateMany({ where: { templateId, status: "published" }, data: { status: "archived" } });
      const published = await tx.takedownTemplateVersion.update({ where: { id: draft.id }, data: { status: "published", publishedBy: email, publishedAt: new Date() } });
      await recordAutomationEvent(tx, orgId, { userId: request.auth!.userId, email }, "template.publish", {
        templateId,
        channel: template.channel,
        kind: template.kind,
        language: template.language,
        brandId: template.brandId,
        version: published.version,
      });
      return reply.send(published);
    });
  });

  // Stops using this scope's published version: reports fall back to the org's (for a brand),
  // or the built-in text. The version stays in the history.
  app.post("/api/report-templates/:templateId/retire", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const template = await tx.takedownTemplate.findFirst({ where: { id: templateId, organizationId: orgId } });
      if (!template) return reply.status(404).send({ error: "not_found" });
      const { count } = await tx.takedownTemplateVersion.updateMany({ where: { templateId, status: "published" }, data: { status: "archived" } });
      if (count === 0) return reply.status(404).send({ error: "not_found" });
      const email = await actorEmail(tx, request.auth!.userId);
      await recordAutomationEvent(tx, orgId, { userId: request.auth!.userId, email }, "template.retire", {
        templateId,
        channel: template.channel,
        kind: template.kind,
        language: template.language,
        brandId: template.brandId,
      });
      return reply.send({ ok: true });
    });
  });

  app.get("/api/report-templates/:templateId/versions", { preHandler: authenticate }, async (request, reply) => {
    const { templateId } = request.params as { templateId: string };
    const orgId = request.auth!.orgId;
    const versions = await withTenant(orgId, (tx) =>
      tx.takedownTemplateVersion.findMany({ where: { templateId, organizationId: orgId }, orderBy: { version: "desc" } })
    );
    return reply.send(versions);
  });

  // Renders text (saved or not) against a real finding, or a made-up one when there's none.
  // POST only because the text is too long for a query string; it writes nothing.
  async function render(request: FastifyRequest) {
    const p = PreviewSchema.safeParse(request.body);
    if (!p.success) return { error: "invalid_request" as const };
    const { brandId, channel, kind, subject, body, findingId } = p.data;
    if (!isValidChannelKind(channel, kind)) return { error: "invalid_request" as const };
    const orgId = request.auth!.orgId;
    const errors = validateTemplate({ subject, body }, channel);
    return withTenant(orgId, async (tx) => {
      if (!(await brandInOrg(tx, orgId, brandId))) return { error: "not_found" as const };
      const target =
        findingId ??
        (
          await tx.finding.findFirst({
            where: { type: { in: channel === "registrar" ? ["domain"] : ["domain", "url"] }, ...(brandId ? { brandId } : {}) },
            orderBy: [{ riskScore: "desc" }, { firstDetectedAt: "desc" }],
            select: { id: true },
          })
        )?.id;
      let context: ReportContext | null = null;
      let identifier: string | null = null;
      if (target) {
        const loaded = await loadReportContext(tx, orgId, target, { reportRef: "BM-PREVIEW", apiOrigin: apiOrigin(request) });
        if (loaded && loaded.finding.type !== "social") {
          context = loaded.context;
          identifier = loaded.finding.identifier;
        }
      }
      if (!context) {
        const brand = brandId
          ? await tx.brand.findFirstOrThrow({ where: { id: brandId }, select: { name: true, primaryDomain: true } })
          : ((await tx.brand.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" }, select: { name: true, primaryDomain: true } })) ?? {
              name: "Your brand",
              primaryDomain: "yourbrand.example",
            });
        const [org, automation, sender] = await Promise.all([
          tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
          tx.takedownAutomation.findUnique({ where: { organizationId: orgId }, select: { companyDetails: true, disclaimer: true } }),
          tx.takedownSender.findUnique({ where: { organizationId: orgId }, select: { signature: true } }),
        ]);
        context = sampleContext({
          brand: { name: brand.name, officialDomain: brand.primaryDomain },
          org: { name: org.name, details: automation?.companyDetails ?? null, disclaimer: automation?.disclaimer ?? null },
          signature: sender?.signature ?? null,
          signatory: null,
        });
      }
      return { errors, rendered: renderTemplate({ subject, body }, context), finding: identifier, channel, kind: kind as Kind };
    });
  }

  app.post("/api/report-templates/preview", { preHandler: authenticate }, async (request, reply) => {
    const result = await render(request);
    if ("error" in result) return reply.status(result.error === "not_found" ? 404 : 400).send({ error: result.error });
    return reply.send(result);
  });

  // The rendered text, from the org's sender mailbox, to the member asking (nobody else).
  app.post("/api/report-templates/test", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const result = await render(request);
    if ("error" in result) return reply.status(result.error === "not_found" ? 404 : 400).send({ error: result.error });
    if (result.errors.length) return reply.status(400).send({ error: "invalid_template", errors: result.errors });
    const sent = await sendTestToSelf(
      request.auth!.orgId,
      request.auth!.userId,
      "template.test",
      {
        subject: `[TEST] ${result.rendered.subject || "Report text"}`,
        text: `TEST of a report template (${result.channel}, ${result.kind})${result.finding ? `, filled in with the finding ${result.finding}` : ", filled in with made-up data"}. Nothing was sent to anyone else.\n\n----------\n\n${result.rendered.body}`,
      },
      { channel: result.channel, kind: result.kind }
    );
    if (sent.status === "no_sender") return reply.status(400).send({ error: "no_sender" });
    if (sent.status === "too_many") return reply.status(429).send({ error: "too_many_sender_tests" });
    if (sent.status === "unreadable") return reply.status(400).send({ error: "sender_unreadable" });
    return reply.send(sent.status === "sent" ? { ok: true, to: sent.to, error: null } : { ok: false, to: sent.to, error: sent.error });
  });

  // The org's fixed text: company details (in every signature block) and an optional disclaimer.
  app.put("/api/report-templates/profile", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const parsed = ProfileSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    const data = {
      companyDetails: parsed.data.companyDetails?.trim() || null,
      disclaimer: parsed.data.disclaimer?.trim() || null,
    };
    if (/\{\{|\}\}/.test(`${data.companyDetails ?? ""}${data.disclaimer ?? ""}`)) return reply.status(400).send({ error: "invalid_request" });
    return withTenant(orgId, async (tx) => {
      await tx.takedownAutomation.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data }, update: data });
      await recordAutomationEvent(tx, orgId, { userId: request.auth!.userId, email: await actorEmail(tx, request.auth!.userId) }, "profile.save");
      return reply.send(data);
    });
  });
}
