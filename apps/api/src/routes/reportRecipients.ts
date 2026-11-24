import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { recordAutomationEvent } from "../lib/takedownAutomation";
import { CHANNELS, LANGUAGES } from "../lib/reportTemplates";
import { loadRoutingData, MATCH_TYPES, METHODS, normalizeMatchValue } from "../lib/recipients";

// Settings -> Takedowns -> Report recipients (TAKEDOWN_AUTOMATION_PLAN.md §3): the org's contact
// book, fixed recipients per channel, the never-send-to list and redirect mode. The platform's
// contact book is shown read-only here and edited in /admin (routes/admin.ts).

const email = z.string().trim().toLowerCase().email().max(254);
const emails = z.array(email).max(10);

// Shared with the admin routes (platform contact book).
export const ContactSchema = z
  .object({
    channel: z.enum(CHANNELS),
    matchType: z.enum(MATCH_TYPES),
    matchValue: z.string().trim().max(100).default(""),
    method: z.enum(METHODS),
    emails: emails.default([]),
    formUrl: z.string().trim().url().max(500).nullable().optional().transform((v) => v || null),
    instructions: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
    language: z.enum(LANGUAGES).nullable().optional().transform((v) => v ?? null),
    note: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
    enabled: z.boolean().default(true),
  })
  .transform((c) => ({ ...c, matchValue: normalizeMatchValue(c.matchType, c.matchValue) }))
  .superRefine((c, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
    if (c.matchType === "iana_id" && !/^[0-9]{1,6}$/.test(c.matchValue)) issue("An IANA ID is a number.", "matchValue");
    if (c.matchType === "iana_id" && c.channel !== "registrar") issue("IANA IDs only identify registrars.", "matchType");
    if (c.matchType === "name" && c.matchValue.length < 3) issue("Give at least 3 letters of the name.", "matchValue");
    if (c.matchType === "name" && !["registrar", "host"].includes(c.channel)) issue("Name matching is for registrars and hosts.", "matchType");
    if (c.matchType === "tld" && !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(c.matchValue)) issue("Give a domain ending such as ke or co.ke.", "matchValue");
    if (c.method === "email" && c.emails.length === 0) issue("Add at least one address.", "emails");
    if (c.method === "form" && !c.formUrl?.startsWith("https://")) issue("A web form needs an https:// address.", "formUrl");
    if (c.channel === "blocklist" && c.method === "email") issue("Blocklists are reported through web forms.", "method");
  });

const FixedSchema = z.object({ to: emails, cc: emails, bcc: emails });
const BlockedSchema = z.object({
  // An exact address, or @domain for a whole domain.
  value: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => z.string().email().safeParse(v).success || /^@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v), "an address or @domain"),
  note: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
});
const RedirectSchema = z.object({ redirectTo: email.nullable() });

async function actor(tx: Prisma.TransactionClient, userId: string) {
  return { userId, email: (await tx.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null };
}

export async function reportRecipientRoutes(app: FastifyInstance) {
  app.get("/api/report-recipients", { preHandler: authenticate }, async (request) => {
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const [data, contacts, platform, settings, blocked] = await Promise.all([
        loadRoutingData(tx, orgId),
        tx.takedownContact.findMany({ where: { organizationId: orgId }, orderBy: [{ channel: "asc" }, { createdAt: "asc" }] }),
        tx.takedownPlatformContact.findMany({ orderBy: [{ channel: "asc" }, { createdAt: "asc" }] }),
        tx.takedownChannelSetting.findMany({ where: { organizationId: orgId } }),
        tx.takedownBlockedRecipient.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } }),
      ]);
      return {
        contacts,
        platformContacts: platform,
        fixed: Object.fromEntries(CHANNELS.map((c) => [c, settings.find((s) => s.channel === c) ?? { to: [], cc: [], bcc: [] }])),
        blocked,
        ownDomains: data.ownDomains,
        redirectTo: data.redirectTo,
      };
    });
  });

  app.post("/api/report-recipients/contacts", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const parsed = ContactSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_contact", details: parsed.error.flatten() });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      if ((await tx.takedownContact.count({ where: { organizationId: orgId } })) >= 200) return reply.status(400).send({ error: "too_many_contacts" });
      const a = await actor(tx, request.auth!.userId);
      const created = await tx.takedownContact.create({ data: { organizationId: orgId, ...parsed.data, createdBy: a.email ?? a.userId } });
      await recordAutomationEvent(tx, orgId, a, "contact.create", { id: created.id, channel: created.channel, matchType: created.matchType, matchValue: created.matchValue, method: created.method });
      return reply.status(201).send(created);
    });
  });

  app.put("/api/report-recipients/contacts/:id", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ContactSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_contact", details: parsed.error.flatten() });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const { count } = await tx.takedownContact.updateMany({ where: { id, organizationId: orgId }, data: parsed.data });
      if (count === 0) return reply.status(404).send({ error: "not_found" });
      await recordAutomationEvent(tx, orgId, await actor(tx, request.auth!.userId), "contact.update", { id, channel: parsed.data.channel, matchValue: parsed.data.matchValue, method: parsed.data.method });
      return reply.send(await tx.takedownContact.findUnique({ where: { id } }));
    });
  });

  app.delete("/api/report-recipients/contacts/:id", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const existing = await tx.takedownContact.findFirst({ where: { id, organizationId: orgId } });
      if (!existing) return reply.status(404).send({ error: "not_found" });
      await tx.takedownContact.delete({ where: { id } });
      await recordAutomationEvent(tx, orgId, await actor(tx, request.auth!.userId), "contact.delete", { id, channel: existing.channel, matchValue: existing.matchValue });
      return reply.status(204).send();
    });
  });

  app.put("/api/report-recipients/fixed/:channel", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const channel = z.enum(CHANNELS).safeParse((request.params as { channel: string }).channel);
    const parsed = FixedSchema.safeParse(request.body);
    if (!channel.success || !parsed.success || channel.data === "blocklist") return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    const data = { to: [...new Set(parsed.data.to)], cc: [...new Set(parsed.data.cc)], bcc: [...new Set(parsed.data.bcc)] };
    return withTenant(orgId, async (tx) => {
      await tx.takedownChannelSetting.upsert({
        where: { organizationId_channel: { organizationId: orgId, channel: channel.data } },
        create: { organizationId: orgId, channel: channel.data, ...data },
        update: data,
      });
      await recordAutomationEvent(tx, orgId, await actor(tx, request.auth!.userId), "fixed.save", { channel: channel.data, ...data });
      return reply.send(data);
    });
  });

  app.post("/api/report-recipients/blocked", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const parsed = BlockedSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const a = await actor(tx, request.auth!.userId);
      const row = await tx.takedownBlockedRecipient.upsert({
        where: { organizationId_value: { organizationId: orgId, value: parsed.data.value } },
        create: { organizationId: orgId, value: parsed.data.value, note: parsed.data.note, reason: "manual", createdBy: a.email ?? a.userId },
        update: { note: parsed.data.note, reason: "manual", expiresAt: null },
      });
      await recordAutomationEvent(tx, orgId, a, "blocked.add", { value: row.value });
      return reply.status(201).send(row);
    });
  });

  app.delete("/api/report-recipients/blocked/:id", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const row = await tx.takedownBlockedRecipient.findFirst({ where: { id, organizationId: orgId } });
      if (!row) return reply.status(404).send({ error: "not_found" });
      await tx.takedownBlockedRecipient.delete({ where: { id } });
      await recordAutomationEvent(tx, orgId, await actor(tx, request.auth!.userId), "blocked.remove", { value: row.value });
      return reply.status(204).send();
    });
  });

  // Redirect (test) mode: every report goes to this address of the org's instead. Owner only.
  app.put("/api/report-recipients/redirect", { preHandler: [authenticate, requireRole("owner")] }, async (request, reply) => {
    const parsed = RedirectSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    const redirectTo = parsed.data.redirectTo;
    return withTenant(orgId, async (tx) => {
      await tx.takedownAutomation.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, redirectTo }, update: { redirectTo } });
      await recordAutomationEvent(tx, orgId, await actor(tx, request.auth!.userId), redirectTo ? "redirect.on" : "redirect.off", redirectTo ? { redirectTo } : undefined);
      return reply.send({ redirectTo });
    });
  });
}
