import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { decryptSecret, encryptionConfigured, encryptSecret } from "../auth/secretBox";
import {
  automationBlockers,
  ENABLE_REQUIRES,
  loadAutomationState,
  recordAutomationEvent,
} from "../lib/takedownAutomation";
import {
  canReadMailbox,
  checkSenderDns,
  MailSendError,
  parseServiceAccountKey,
  publicConfigOf,
  sendOrgMail,
  SenderSecretsSchema,
  type SenderSecrets,
} from "../lib/orgMailer";
import { env } from "../env";
import { CHANNEL_MODES, SIGNALS, STAGES } from "../lib/takedownPolicy";
import { CHANNELS } from "../lib/reportTemplates";
import { testsToday, TESTS_PER_DAY } from "../lib/selfTestSend";

// Settings for automatic takedown reporting (TAKEDOWN_AUTOMATION_PLAN.md, step 1): the org's
// switches, its sender mailbox, and who authorizes reports in its name. Nothing here sends a
// report: only the sender test does, to an address the owner types in.
//
// Roles: the owner sets up the sender and authorization and turns it on; owners/admins switch
// brands; anyone from analyst up can stop all sending, and only an owner resumes it.

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENTS_PER_AUTHORIZATION = 20;
const DOCUMENT_TYPES: Record<string, { magic: number[] }> = {
  "application/pdf": { magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  "image/png": { magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/jpeg": { magic: [0xff, 0xd8, 0xff] },
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .pipe(z.string().email().nullable());

const SenderSchema = z.object({
  fromAddress: z.string().trim().toLowerCase().email().max(254),
  fromName: optionalText(100),
  replyTo: optionalEmail,
  bccArchive: optionalEmail,
  signature: optionalText(2000),
  // Secret fields may be left out to keep the stored ones (same provider only).
  config: z.discriminatedUnion("provider", [
    z.object({ provider: z.literal("graph"), tenantId: z.string(), clientId: z.string(), clientSecret: z.string().optional() }),
    z.object({ provider: z.literal("gmail"), serviceAccountKey: z.string().optional() }),
    z.object({ provider: z.literal("smtp"), host: z.string(), port: z.number().int(), username: z.string(), password: z.string().optional() }),
  ]),
});

const TestSchema = z.object({ to: z.string().trim().toLowerCase().email().max(254) });

const AuthorizationSchema = z
  .object({
    brandId: z.string().min(1).max(64).optional().nullable().transform((v) => v ?? null),
    signatoryName: z.string().trim().min(1).max(120),
    signatoryTitle: z.string().trim().min(1).max(120),
    signatoryEmail: z.string().trim().toLowerCase().email().max(254),
    signatoryPhone: optionalText(40),
    scope: optionalText(1000),
    validFrom: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional().nullable().transform((v) => v ?? null),
  })
  .refine((a) => !a.expiresAt || a.expiresAt > (a.validFrom ?? new Date()), { message: "expiresAt must be after validFrom", path: ["expiresAt"] });

const DOCUMENT_FIELDS = { id: true, authorizationId: true, kind: true, filename: true, contentType: true, sizeBytes: true, sha256: true, uploadedBy: true, createdAt: true } as const;
const SENDER_FIELDS = {
  provider: true, fromAddress: true, fromName: true, replyTo: true, bccArchive: true, signature: true, publicConfig: true,
  lastTestAt: true, lastTestOk: true, lastTestError: true, lastTestTo: true, updatedAt: true, updatedBy: true,
  readReplies: true, repliesCheckedAt: true, repliesError: true,
} as const;

const DocumentQuery = z.object({
  kind: z.enum(["loa", "trademark", "other"]),
  filename: z.string().trim().min(1).max(200),
});

const StopSchema = z.object({ reason: optionalText(500) }).default({});
const BrandSwitchSchema = z.object({ enabled: z.boolean() });

async function actorOf(tx: Prisma.TransactionClient, userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
  return { userId, email: u?.email ?? null };
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]/g, "_").trim();
  return cleaned || "document";
}

// Everything the settings page shows. Never the sender's secrets.
async function overview(orgId: string) {
  return withTenant(orgId, async (tx) => {
    const [state, org, automation, sender, authorizations, brands, events] = await Promise.all([
      loadAutomationState(tx, orgId),
      tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { autoTakedownAllowedAt: true, autoTakedownAllowedBy: true } }),
      tx.takedownAutomation.findUnique({ where: { organizationId: orgId } }),
      tx.takedownSender.findUnique({ where: { organizationId: orgId }, select: SENDER_FIELDS }),
      tx.takedownAuthorization.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        include: { documents: { select: DOCUMENT_FIELDS, orderBy: { createdAt: "asc" } } },
      }),
      tx.brand.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, primaryDomain: true, autoTakedownEnabled: true, monitoringPausedAt: true },
        orderBy: { createdAt: "asc" },
      }),
      tx.takedownAutomationEvent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    const [settings, shadow] = await Promise.all([
      tx.takedownChannelSetting.findMany({ where: { organizationId: orgId }, select: { channel: true, mode: true } }),
      tx.takedownAction.groupBy({ by: ["shadowVerdict"], where: { organizationId: orgId, status: "shadow" }, _count: { _all: true } }),
    ]);
    const verdict = (v: string | null) => shadow.find((x) => x.shadowVerdict === v)?._count._all ?? 0;
    return {
      platformEnabled: env.autoTakedownEnabled,
      encryptionConfigured: encryptionConfigured(),
      allowedAt: org.autoTakedownAllowedAt,
      allowedBy: org.autoTakedownAllowedBy,
      automation: automation ?? null,
      sender: sender ?? null,
      authorizations,
      brands: brands.map((b) => ({ ...b, blockers: automationBlockers(state, b) })),
      blockers: automationBlockers(state),
      events,
      channelModes: Object.fromEntries(CHANNELS.map((c) => [c, settings.find((x) => x.channel === c)?.mode ?? "off"])),
      shadowStats: { right: verdict("right"), wrong: verdict("wrong"), unreviewed: verdict(null) },
    };
  });
}

export async function takedownAutomationRoutes(app: FastifyInstance) {
  // Document uploads arrive as the raw file (Content-Type = the file's type), in this plugin only.
  app.addContentTypeParser(Object.keys(DOCUMENT_TYPES), { parseAs: "buffer", bodyLimit: MAX_DOCUMENT_BYTES }, (_req, body, done) => done(null, body));

  app.get("/api/takedown-automation", { preHandler: authenticate }, async (request) => overview(request.auth!.orgId));

  // --- Sender mailbox ---------------------------------------------------------------------

  app.put("/api/takedown-automation/sender", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    if (!encryptionConfigured()) return reply.status(400).send({ error: "encryption_not_configured" });
    const parsed = SenderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const orgId = request.auth!.orgId;
    const body = parsed.data;

    return withTenant(orgId, async (tx) => {
      const existing = await tx.takedownSender.findUnique({ where: { organizationId: orgId } });
      let previous: SenderSecrets | null = null;
      if (existing && existing.provider === body.config.provider) {
        try {
          previous = SenderSecretsSchema.parse(JSON.parse(decryptSecret(existing.config)));
        } catch {
          previous = null; // unreadable (e.g. key changed): the secret must be entered again
        }
      }
      const merged = { ...(previous ?? {}), ...Object.fromEntries(Object.entries(body.config).filter(([, v]) => v !== undefined && v !== "")) };
      const secrets = SenderSecretsSchema.safeParse(merged);
      if (!secrets.success) return reply.status(400).send({ error: "invalid_sender_config", details: secrets.error.flatten() });
      if (secrets.data.provider === "gmail" && !parseServiceAccountKey(secrets.data.serviceAccountKey)) {
        return reply.status(400).send({ error: "invalid_service_account_key" });
      }

      const actor = await actorOf(tx, request.auth!.userId);
      const data = {
        provider: secrets.data.provider,
        fromAddress: body.fromAddress,
        fromName: body.fromName,
        replyTo: body.replyTo,
        bccArchive: body.bccArchive,
        signature: body.signature,
        config: encryptSecret(JSON.stringify(secrets.data)),
        publicConfig: publicConfigOf(secrets.data),
        // A changed sender has to pass a test again.
        lastTestAt: null,
        lastTestOk: null,
        lastTestError: null,
        lastTestTo: null,
        updatedBy: actor.email,
        ...(canReadMailbox(secrets.data.provider) ? {} : { readReplies: false }),
      };
      await tx.takedownSender.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data }, update: data });
      await recordAutomationEvent(tx, orgId, actor, "sender.save", { provider: data.provider, fromAddress: data.fromAddress });
      return reply.send({ ok: true });
    });
  });

  app.delete("/api/takedown-automation/sender", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const { count } = await tx.takedownSender.deleteMany({ where: { organizationId: orgId } });
      if (count === 0) return reply.status(404).send({ error: "not_found" });
      await recordAutomationEvent(tx, orgId, await actorOf(tx, request.auth!.userId), "sender.delete");
      return reply.status(204).send();
    });
  });

  // A real email from the org's mailbox to an address the owner/admin chose. Passing it is what
  // marks the sender as working.
  app.post("/api/takedown-automation/sender/test", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const parsed = TestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;

    const prep = await withTenant(orgId, async (tx) => {
      const sender = await tx.takedownSender.findUnique({ where: { organizationId: orgId } });
      const recent = await testsToday(tx, orgId);
      const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } });
      return { sender, recent, orgName: org.name, actor: await actorOf(tx, request.auth!.userId) };
    });
    if (!prep.sender) return reply.status(404).send({ error: "not_found" });
    if (prep.recent >= TESTS_PER_DAY) return reply.status(429).send({ error: "too_many_sender_tests" });

    let secrets: SenderSecrets;
    try {
      secrets = SenderSecretsSchema.parse(JSON.parse(decryptSecret(prep.sender.config)));
    } catch {
      return reply.status(400).send({ error: "sender_unreadable" });
    }
    const s = prep.sender;
    const sentAt = new Date();
    const text = [
      `This is a test of the mailbox ${prep.orgName} uses to send takedown reports through Brand Monitor. No action is needed.`,
      "",
      "Automatic takedown reports will come from this address, signed like this:",
      "",
      s.signature ?? "(no signature set)",
      "",
      `Sent ${sentAt.toISOString().replace("T", " ").slice(0, 16)} UTC by ${prep.actor.email ?? "a member"}.`,
    ].join("\n");

    let ok = true;
    let error: string | null = null;
    try {
      await sendOrgMail(
        secrets,
        { fromAddress: s.fromAddress, fromName: s.fromName, replyTo: s.replyTo, bccArchive: s.bccArchive },
        { to: [parsed.data.to], subject: "Test from Brand Monitor: takedown report sender", text }
      );
    } catch (err: any) {
      ok = false;
      // fetch() failures carry the real reason (DNS, TLS, timeout) in err.cause.
      const cause = err?.cause?.code ?? err?.cause?.message;
      error = err instanceof MailSendError ? err.message : `Sending failed: ${String(err?.message ?? err)}${cause ? ` (${cause})` : ""}`.slice(0, 300);
      request.log.warn({ err: error }, "takedown sender test failed");
    }

    await withTenant(orgId, async (tx) => {
      // Only record the result against the settings that were tested (they may have changed meanwhile).
      await tx.takedownSender.updateMany({
        where: { organizationId: orgId, updatedAt: s.updatedAt },
        data: { lastTestAt: sentAt, lastTestOk: ok, lastTestError: error, lastTestTo: parsed.data.to },
      });
      await recordAutomationEvent(tx, orgId, prep.actor, "sender.test", { to: parsed.data.to, ok, ...(error ? { error } : {}) });
    });
    return reply.send({ ok, error });
  });

  // SPF/DMARC records of the sender's domain, shown during setup. Read-only.
  app.get("/api/takedown-automation/sender/dns", { preHandler: authenticate }, async (request, reply) => {
    const orgId = request.auth!.orgId;
    const sender = await withTenant(orgId, (tx) => tx.takedownSender.findUnique({ where: { organizationId: orgId }, select: { fromAddress: true } }));
    if (!sender) return reply.status(404).send({ error: "not_found" });
    return reply.send(await checkSenderDns(sender.fromAddress));
  });

  // --- Authorization ----------------------------------------------------------------------

  app.post("/api/takedown-automation/authorizations", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    const parsed = AuthorizationSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const orgId = request.auth!.orgId;
    const a = parsed.data;
    return withTenant(orgId, async (tx) => {
      if (a.brandId && !(await tx.brand.findFirst({ where: { id: a.brandId, organizationId: orgId }, select: { id: true } }))) {
        return reply.status(400).send({ error: "invalid_request" });
      }
      const actor = await actorOf(tx, request.auth!.userId);
      const created = await tx.takedownAuthorization.create({
        data: {
          organizationId: orgId,
          brandId: a.brandId,
          signatoryName: a.signatoryName,
          signatoryTitle: a.signatoryTitle,
          signatoryEmail: a.signatoryEmail,
          signatoryPhone: a.signatoryPhone,
          scope: a.scope,
          validFrom: a.validFrom ?? new Date(),
          expiresAt: a.expiresAt,
          createdBy: actor.email ?? actor.userId,
        },
      });
      await recordAutomationEvent(tx, orgId, actor, "authorization.create", { id: created.id, signatory: a.signatoryName, brandId: a.brandId, expiresAt: a.expiresAt });
      return reply.status(201).send(created);
    });
  });

  app.post("/api/takedown-automation/authorizations/:id/revoke", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const actor = await actorOf(tx, request.auth!.userId);
      const { count } = await tx.takedownAuthorization.updateMany({
        where: { id, organizationId: orgId, revokedAt: null },
        data: { revokedAt: new Date(), revokedBy: actor.email ?? actor.userId },
      });
      if (count === 0) return reply.status(404).send({ error: "not_found" });
      await recordAutomationEvent(tx, orgId, actor, "authorization.revoke", { id });
      return reply.send({ ok: true });
    });
  });

  // The file itself is the request body; kind and filename come in the query string.
  app.post(
    "/api/takedown-automation/authorizations/:id/documents",
    { preHandler: [authenticate, requireRole("owner")], bodyLimit: MAX_DOCUMENT_BYTES },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as { id: string };
      const query = DocumentQuery.safeParse(request.query);
      const contentType = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const type = DOCUMENT_TYPES[contentType];
      const body = request.body;
      if (!query.success || !type || !Buffer.isBuffer(body) || body.length === 0) return reply.status(400).send({ error: "invalid_document" });
      if (!type.magic.every((byte, i) => body[i] === byte)) return reply.status(400).send({ error: "invalid_document" });
      const orgId = request.auth!.orgId;

      return withTenant(orgId, async (tx) => {
        const authorization = await tx.takedownAuthorization.findFirst({ where: { id, organizationId: orgId }, include: { _count: { select: { documents: true } } } });
        if (!authorization) return reply.status(404).send({ error: "not_found" });
        if (authorization._count.documents >= MAX_DOCUMENTS_PER_AUTHORIZATION) return reply.status(400).send({ error: "too_many_documents" });
        const actor = await actorOf(tx, request.auth!.userId);
        const doc = await tx.takedownDocument.create({
          data: {
            organizationId: orgId,
            authorizationId: id,
            kind: query.data.kind,
            filename: safeFilename(query.data.filename),
            contentType,
            sizeBytes: body.length,
            sha256: createHash("sha256").update(body).digest("hex"),
            data: body,
            uploadedBy: actor.email ?? actor.userId,
          },
          select: DOCUMENT_FIELDS,
        });
        await recordAutomationEvent(tx, orgId, actor, "document.upload", { id: doc.id, authorizationId: id, kind: doc.kind, filename: doc.filename, sha256: doc.sha256 });
        return reply.status(201).send(doc);
      });
    }
  );

  app.get("/api/takedown-automation/documents/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    const doc = await withTenant(orgId, (tx) => tx.takedownDocument.findFirst({ where: { id, organizationId: orgId } }));
    if (!doc) return reply.status(404).send({ error: "not_found" });
    return reply
      .header("Content-Type", doc.contentType)
      .header("Content-Disposition", `attachment; filename="${safeFilename(doc.filename)}"`)
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .send(Buffer.from(doc.data));
  });

  app.delete("/api/takedown-automation/documents/:id", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const doc = await tx.takedownDocument.findFirst({ where: { id, organizationId: orgId }, select: DOCUMENT_FIELDS });
      if (!doc) return reply.status(404).send({ error: "not_found" });
      await tx.takedownDocument.delete({ where: { id } });
      await recordAutomationEvent(tx, orgId, await actorOf(tx, request.auth!.userId), "document.delete", { id, kind: doc.kind, filename: doc.filename, sha256: doc.sha256 });
      return reply.status(204).send();
    });
  });

  // --- Switches ---------------------------------------------------------------------------

  app.post("/api/takedown-automation/enable", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const missing = automationBlockers(await loadAutomationState(tx, orgId)).filter((b) => ENABLE_REQUIRES.includes(b));
      if (missing.length > 0) return reply.status(409).send({ error: "automation_not_ready", blockers: missing });
      const actor = await actorOf(tx, request.auth!.userId);
      const existing = await tx.takedownAutomation.findUnique({ where: { organizationId: orgId }, select: { shadowStartedAt: true } });
      // The shadow period (TAKEDOWN_AUTOMATION_PLAN.md §10) starts the first time it's turned on.
      const data = { enabledAt: new Date(), enabledBy: actor.email, ...(existing?.shadowStartedAt ? {} : { shadowStartedAt: new Date() }) };
      await tx.takedownAutomation.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data }, update: data });
      await recordAutomationEvent(tx, orgId, actor, "enable");
      return reply.send({ ok: true });
    });
  });

  app.post("/api/takedown-automation/disable", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      await tx.takedownAutomation.updateMany({ where: { organizationId: orgId }, data: { enabledAt: null, enabledBy: null } });
      await recordAutomationEvent(tx, orgId, await actorOf(tx, request.auth!.userId), "disable");
      return reply.send({ ok: true });
    });
  });

  // The emergency stop: works whatever else is set, takes effect at once.
  app.post("/api/takedown-automation/stop", { preHandler: [authenticate, requireRole("owner", "admin", "analyst")] }, async (request, reply) => {
    const parsed = StopSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const actor = await actorOf(tx, request.auth!.userId);
      const current = await tx.takedownAutomation.findUnique({ where: { organizationId: orgId } });
      if (current?.stoppedAt) return reply.send({ ok: true });
      const data = { stoppedAt: new Date(), stoppedBy: actor.email, stopReason: parsed.data.reason };
      await tx.takedownAutomation.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data }, update: data });
      await recordAutomationEvent(tx, orgId, actor, "stop", parsed.data.reason ? { reason: parsed.data.reason } : undefined);
      return reply.send({ ok: true });
    });
  });

  app.post("/api/takedown-automation/resume", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const { count } = await tx.takedownAutomation.updateMany({
        where: { organizationId: orgId, stoppedAt: { not: null } },
        data: { stoppedAt: null, stoppedBy: null, stopReason: null },
      });
      if (count > 0) await recordAutomationEvent(tx, orgId, await actorOf(tx, request.auth!.userId), "resume");
      return reply.send({ ok: true });
    });
  });

  app.put("/api/takedown-automation/brands/:id", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = BrandSwitchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const { count } = await tx.brand.updateMany({ where: { id, organizationId: orgId }, data: { autoTakedownEnabled: parsed.data.enabled } });
      if (count === 0) return reply.status(404).send({ error: "not_found" });
      await recordAutomationEvent(tx, orgId, await actorOf(tx, request.auth!.userId), parsed.data.enabled ? "brand.on" : "brand.off", { brandId: id });
      return reply.send({ ok: true });
    });
  });
  // --- Sending (step 4): policy, a mode per channel, and the stage ----------------------------

  const PolicySchema = z.object({
    minSeverity: z.enum(["high", "critical"]),
    signals: z.array(z.enum(SIGNALS)).max(SIGNALS.length),
    confirmedSkipsVeto: z.boolean(),
    vetoHours: z.number().int().min(1).max(72),
    dailyCap: z.number().int().min(1).max(200),
    perRecipientCap: z.number().int().min(1).max(50),
    followUpDays: z.number().int().min(1).max(30),
    escalateDays: z.number().int().min(1).max(60),
  });

  // Reading replies needs an extra permission in the org's mail system (Mail.Read / gmail.readonly).
  app.put("/api/takedown-automation/sender/read-replies", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const sender = await tx.takedownSender.findUnique({ where: { organizationId: orgId }, select: { provider: true } });
      if (!sender) return reply.status(404).send({ error: "not_found" });
      if (parsed.data.enabled && !canReadMailbox(sender.provider)) return reply.status(400).send({ error: "replies_not_supported" });
      await tx.takedownSender.update({ where: { organizationId: orgId }, data: { readReplies: parsed.data.enabled, repliesCheckedAt: null, repliesError: null } });
      await recordAutomationEvent(tx, orgId, await actorOf(tx, request.auth!.userId), parsed.data.enabled ? "replies.on" : "replies.off");
      return reply.send({ readReplies: parsed.data.enabled });
    });
  });

  app.put("/api/takedown-automation/policy", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const parsed = PolicySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      await tx.takedownAutomation.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...parsed.data }, update: parsed.data });
      await recordAutomationEvent(tx, orgId, await actorOf(tx, request.auth!.userId), "policy.save", parsed.data);
      return reply.send(parsed.data);
    });
  });

  app.put("/api/takedown-automation/channel-modes", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const parsed = z.record(z.enum(CHANNELS), z.enum(CHANNEL_MODES)).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      for (const [channel, mode] of Object.entries(parsed.data)) {
        await tx.takedownChannelSetting.upsert({
          where: { organizationId_channel: { organizationId: orgId, channel } },
          create: { organizationId: orgId, channel, mode },
          update: { mode },
        });
      }
      await recordAutomationEvent(tx, orgId, await actorOf(tx, request.auth!.userId), "modes.save", parsed.data);
      return reply.send(parsed.data);
    });
  });

  // shadow -> redirect -> live. Live needs the shadow period first, and redirect an address.
  app.post("/api/takedown-automation/stage", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    const parsed = z.object({ stage: z.enum(STAGES) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const stage = parsed.data.stage;
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const a = await tx.takedownAutomation.findUnique({ where: { organizationId: orgId } });
      if (!a) return reply.status(409).send({ error: "automation_not_ready" });
      if (stage === "redirect" && !a.redirectTo) return reply.status(409).send({ error: "redirect_needs_address" });
      if (stage === "live") {
        const until = a.shadowStartedAt ? new Date(a.shadowStartedAt.getTime() + a.shadowDays * 86400_000) : null;
        if (!until || until > new Date()) return reply.status(409).send({ error: "shadow_not_done", until });
      }
      await tx.takedownAutomation.update({
        where: { organizationId: orgId },
        data: { stage, stageChangedAt: new Date(), ...(stage === "shadow" && !a.shadowStartedAt ? { shadowStartedAt: new Date() } : {}) },
      });
      await recordAutomationEvent(tx, orgId, await actorOf(tx, request.auth!.userId), "stage.change", { from: a.stage, to: stage });
      return reply.send({ stage });
    });
  });
}
