import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { authorizationInForce } from "../lib/takedownAutomation";
import { CHANNEL_KINDS, CHANNELS, KINDS, LANGUAGES, MAX_BODY, MAX_SUBJECT, newReportRef, renderTemplate, type Channel, type Kind } from "../lib/reportTemplates";
import { channelsFor, factsOf, hostnameOf, loadReportContext, resolveTemplate } from "../lib/reportContext";
import { loadRoutingData, recipientProblems, resolveRouting, type RoutingData } from "../lib/recipients";
import { sendTestToSelf } from "../lib/selfTestSend";
import { EDITABLE_STATUSES } from "../lib/takedownPolicy";

// Report drafts per finding (TAKEDOWN_AUTOMATION_PLAN.md §5.3): rendered from the published
// template, then edited by hand and saved. Step 2 has no real send: a draft can only be tested
// on the member themself. Websites only.

const ANALYST_UP = ["owner", "admin", "analyst"];
const MAX_RECIPIENTS = 10;
const MAX_DRAFTS_PER_FINDING = 30;

const email = z.string().trim().toLowerCase().email().max(254);
const CreateSchema = z
  .object({ channel: z.enum(CHANNELS), kind: z.enum(KINDS).default("first"), language: z.enum(LANGUAGES).optional() })
  .transform((v) => ({ ...v, language: v.language ?? "en", languageGiven: v.language !== undefined }));
const UpdateSchema = z.object({
  to: z.array(email).max(MAX_RECIPIENTS),
  cc: z.array(email).max(MAX_RECIPIENTS),
  bcc: z.array(email).max(MAX_RECIPIENTS),
  subject: z.string().max(MAX_SUBJECT),
  body: z.string().min(1).max(MAX_BODY),
  includeScreenshot: z.boolean(),
  documentIds: z.array(z.string().min(1).max(64)).max(10),
});

function apiOrigin(request: FastifyRequest) {
  return `${request.protocol}://${request.host}`;
}

async function actorEmail(tx: Prisma.TransactionClient, userId: string) {
  return (await tx.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? userId;
}

// Documents that may be attached: those of the authorizations in force for the brand.
async function attachableDocuments(tx: Prisma.TransactionClient, orgId: string, brandId: string) {
  const now = new Date();
  const auths = await tx.takedownAuthorization.findMany({
    where: { organizationId: orgId, revokedAt: null },
    include: { documents: { select: { id: true, kind: true, filename: true, sizeBytes: true, contentType: true } } },
  });
  return auths.filter((a) => authorizationInForce(a, brandId, now)).flatMap((a) => a.documents);
}

async function uniqueReportRef(tx: Prisma.TransactionClient): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const ref = newReportRef(randomBytes);
    if (!(await tx.takedownAction.findUnique({ where: { reportRef: ref }, select: { id: true } }))) return ref;
  }
  throw new Error("could not allocate a report reference");
}

function routeFor(channel: Channel, facts: ReturnType<typeof factsOf>, data: RoutingData) {
  return resolveRouting(channel, facts, data.rules, data.fixed.get(channel) ?? null, data.ownDomains, data.blocked);
}

export async function reportDraftRoutes(app: FastifyInstance) {
  app.get("/api/findings/:id/report-drafts", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const finding = await tx.finding.findUnique({ where: { id }, include: { domainIntel: true, websiteIntel: { select: { screenshotPath: true } } } });
      if (!finding) return reply.status(404).send({ error: "not_found" });
      const [drafts, documents, sender, routingData] = await Promise.all([
        tx.takedownAction.findMany({ where: { findingId: id, organizationId: orgId }, orderBy: { createdAt: "desc" } }),
        attachableDocuments(tx, orgId, finding.brandId),
        tx.takedownSender.findUnique({ where: { organizationId: orgId }, select: { fromAddress: true } }),
        loadRoutingData(tx, orgId),
      ]);
      const facts = factsOf(hostnameOf(finding.identifier), finding.domainIntel);
      return reply.send({
        websitesOnly: finding.type === "social",
        // Where a new report on each channel would go, and why (lib/recipients.ts).
        channels: channelsFor(finding.type).map((c) => ({ channel: c, kinds: CHANNEL_KINDS[c], routing: routeFor(c, facts, routingData) })),
        redirectTo: routingData.redirectTo,
        hasScreenshot: !!finding.websiteIntel?.screenshotPath,
        documents,
        senderAddress: sender?.fromAddress ?? null,
        drafts,
      });
    });
  });

  app.post("/api/findings/:id/report-drafts", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = CreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const { channel, kind, language } = parsed.data;
    if (!(CHANNEL_KINDS[channel] as string[]).includes(kind)) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;

    return withTenant(orgId, async (tx) => {
      const reportRef = await uniqueReportRef(tx);
      const loaded = await loadReportContext(tx, orgId, id, { reportRef, apiOrigin: apiOrigin(request) });
      if (!loaded) return reply.status(404).send({ error: "not_found" });
      if (loaded.finding.type === "social") return reply.status(400).send({ error: "websites_only" });
      if (!channelsFor(loaded.finding.type).includes(channel)) return reply.status(400).send({ error: "channel_not_applicable" });
      if ((await tx.takedownAction.count({ where: { findingId: id } })) >= MAX_DRAFTS_PER_FINDING) return reply.status(400).send({ error: "too_many_drafts" });

      const routing = routeFor(channel, loaded.finding.facts, await loadRoutingData(tx, orgId));
      // A contact-book entry can name the recipient's language; the template falls back to English.
      const reportLanguage = parsed.data.languageGiven ? language : (routing.language ?? language);
      const template = await resolveTemplate(tx, orgId, loaded.finding.brandId, channel, kind, reportLanguage);
      const rendered = renderTemplate(template, loaded.context);
      const by = await actorEmail(tx, request.auth!.userId);
      const draft = await tx.takedownAction.create({
        data: {
          organizationId: orgId,
          brandId: loaded.finding.brandId,
          findingId: id,
          channel,
          kind,
          language: reportLanguage,
          reportRef,
          to: routing.to,
          cc: routing.cc,
          bcc: routing.bcc,
          routing: routing as object,
          subject: rendered.subject,
          body: rendered.body,
          includeScreenshot: !!loaded.finding.screenshotFile,
          templateSource: template.source,
          createdBy: by,
          updatedBy: by,
        },
      });
      return reply.status(201).send(draft);
    });
  });

  // Hand edits. The [BM-...] tag must stay in the subject (except web-form text, which has none).
  app.put("/api/report-drafts/:id", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const d = parsed.data;
    if (/[\r\n]/.test(d.subject)) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const draft = await tx.takedownAction.findFirst({ where: { id, organizationId: orgId } });
      if (!draft) return reply.status(404).send({ error: "not_found" });
      if (!EDITABLE_STATUSES.includes(draft.status)) return reply.status(409).send({ error: "not_a_draft" });
      if (draft.channel !== "blocklist" && !d.subject.includes(`[${draft.reportRef}]`)) return reply.status(400).send({ error: "report_ref_removed" });
      const routingData = await loadRoutingData(tx, orgId);
      const problems = recipientProblems(d, routingData.ownDomains, routingData.blocked);
      if (problems.length) return reply.status(400).send({ error: "recipient_not_allowed", problems });
      const allowed = new Set((await attachableDocuments(tx, orgId, draft.brandId)).map((x) => x.id));
      if (d.documentIds.some((x) => !allowed.has(x))) return reply.status(400).send({ error: "invalid_request" });
      const edited = draft.edited || d.subject !== draft.subject || d.body !== draft.body;
      const updated = await tx.takedownAction.update({
        where: { id },
        data: { ...d, to: [...new Set(d.to)], cc: [...new Set(d.cc)], bcc: [...new Set(d.bcc)], edited, updatedBy: await actorEmail(tx, request.auth!.userId) },
      });
      return reply.send(updated);
    });
  });

  // Throws away hand edits to the text and renders again from the current published template
  // (and the finding's current data). Recipients and attachments are kept.
  app.post("/api/report-drafts/:id/rerender", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const draft = await tx.takedownAction.findFirst({ where: { id, organizationId: orgId } });
      if (!draft) return reply.status(404).send({ error: "not_found" });
      if (!EDITABLE_STATUSES.includes(draft.status)) return reply.status(409).send({ error: "not_a_draft" });
      const loaded = await loadReportContext(tx, orgId, draft.findingId, { reportRef: draft.reportRef, apiOrigin: apiOrigin(request) });
      if (!loaded) return reply.status(404).send({ error: "not_found" });
      const template = await resolveTemplate(tx, orgId, draft.brandId, draft.channel as Channel, draft.kind as Kind, draft.language);
      const rendered = renderTemplate(template, loaded.context);
      const updated = await tx.takedownAction.update({
        where: { id },
        data: { subject: rendered.subject, body: rendered.body, templateSource: template.source, edited: false, updatedBy: await actorEmail(tx, request.auth!.userId) },
      });
      return reply.send(updated);
    });
  });

  app.delete("/api/report-drafts/:id", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      // Only unsent drafts can go: a sent report is the record of what was said.
      const { count } = await tx.takedownAction.deleteMany({ where: { id, organizationId: orgId, status: "draft" } });
      if (count === 0) return reply.status(404).send({ error: "not_found" });
      return reply.status(204).send();
    });
  });

  // The draft exactly as it would go out (attachments included), but only to the member asking.
  app.post("/api/report-drafts/:id/test", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    const prep = await withTenant(orgId, async (tx) => {
      const draft = await tx.takedownAction.findFirst({ where: { id, organizationId: orgId } });
      if (!draft) return null;
      const finding = await tx.finding.findUnique({ where: { id: draft.findingId }, select: { websiteIntel: { select: { screenshotPath: true } } } });
      const documents = draft.documentIds.length
        ? await tx.takedownDocument.findMany({ where: { id: { in: draft.documentIds }, organizationId: orgId }, select: { filename: true, contentType: true, data: true } })
        : [];
      return { draft, screenshotPath: finding?.websiteIntel?.screenshotPath ?? null, documents };
    });
    if (!prep) return reply.status(404).send({ error: "not_found" });
    const { draft } = prep;

    const attachments: Array<{ filename: string; contentType: string; content: Buffer }> = [];
    const file = draft.includeScreenshot ? prep.screenshotPath?.match(/^\/screenshots\/([A-Za-z0-9_-]+\.png)$/)?.[1] : null;
    if (file) {
      const content = await fs.readFile(path.join(process.cwd(), "screenshots", file)).catch(() => null);
      if (content) attachments.push({ filename: "screenshot.png", contentType: "image/png", content });
    }
    for (const d of prep.documents) attachments.push({ filename: d.filename, contentType: d.contentType, content: Buffer.from(d.data) });

    const recipients = [
      `To: ${draft.to.join(", ") || "(nobody yet)"}`,
      ...(draft.cc.length ? [`Cc: ${draft.cc.join(", ")}`] : []),
      ...(draft.bcc.length ? [`Bcc: ${draft.bcc.join(", ")}`] : []),
    ];
    const redirectTo = await withTenant(orgId, (tx) => tx.takedownAutomation.findUnique({ where: { organizationId: orgId }, select: { redirectTo: true } })).then((a) => a?.redirectTo ?? null);
    if (redirectTo) recipients.push(`Redirect mode is on: it would be delivered to ${redirectTo} instead.`);
    const sent = await sendTestToSelf(
      orgId,
      request.auth!.userId,
      "draft.test",
      {
        subject: `[TEST] ${draft.subject || "Report text"}`,
        text: `TEST of a report draft. Only you received this. The real report would go to:\n${recipients.join("\n")}\n\n----------\n\n${draft.body}`,
        attachments,
      },
      { draftId: id, findingId: draft.findingId, channel: draft.channel }
    );
    if (sent.status === "no_sender") return reply.status(400).send({ error: "no_sender" });
    if (sent.status === "too_many") return reply.status(429).send({ error: "too_many_sender_tests" });
    if (sent.status === "unreadable") return reply.status(400).send({ error: "sender_unreadable" });
    if (sent.status === "sent") await withTenant(orgId, (tx) => tx.takedownAction.update({ where: { id }, data: { lastTestAt: new Date() } }));
    return reply.send(sent.status === "sent" ? { ok: true, to: sent.to, error: null } : { ok: false, to: sent.to, error: sent.error });
  });
}
