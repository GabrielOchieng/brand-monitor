import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { adminPrisma } from "../adminDb";
import { env } from "../env";
import { requirePlatformAdmin, VALID_ROLES } from "../lib/auth";
import { normalizeEmail } from "../auth/crypto";
import { createOrganization } from "../auth/orgs";
import { issueToken, revokeTokens } from "../auth/tokens";
import { sendAdminPasswordLinkEmail, sendInviteEmail } from "../auth/emails";
import { TOTP_OFF } from "../auth/mfa";
import { deleteOrganization } from "../admin/deleteOrg";
import { startAdminView } from "../auth/adminView";
import { recordAdminAction } from "../auth/audit";
import { tavilyPeriod } from "../lib/tavily";
import { automationBlockers, loadAutomationState, recordAutomationEvent } from "../lib/takedownAutomation";
import { ContactSchema } from "./reportRecipients";
import { ACCESS_REQUEST_STATUSES } from "../lib/accessRequests";

// The platform admin panel. Everything here reads across organizations through adminPrisma
// (see adminDb.ts), behind requirePlatformAdmin (platform role + 2FA). Every change is
// recorded in admin_audit_log.

const CreateOrgSchema = z.object({ name: z.string().trim().min(1).max(100) });
const InviteSchema = z.object({ email: z.string().trim().min(3).max(254).email(), role: z.enum(VALID_ROLES).default("owner") });

const n = (v: bigint | number | null) => (v === null ? 0 : Number(v));

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function adminOf(request: FastifyRequest): Promise<{ userId: string; email: string }> {
  const user = await adminPrisma.user.findUniqueOrThrow({ where: { id: request.user!.userId } });
  return { userId: user.id, email: user.email };
}

export async function adminRoutes(app: FastifyInstance) {
  // Every route in this plugin, unconditionally. The hook is scoped to this plugin by Fastify's
  // encapsulation (it isn't wrapped in fastify-plugin), so no path test is needed -- and one on the
  // raw request.url was bypassable: the router matches the decoded path, so /api/%61dmin/... reached
  // these handlers without the check.
  app.addHook("preHandler", requirePlatformAdmin);

  // Every org with its size, this month's usage and when a member was last active.
  app.get("/api/admin/overview", async () => {
    const since = monthStart();
    const orgs = await adminPrisma.$queryRaw<
      Array<{ id: string; name: string; created_at: Date; monitoring_paused_at: Date | null; paused_brands: bigint; members: bigint; brands: bigint; findings: bigint; scans_month: bigint; emails_month: bigint; last_active: Date | null; tavily_month: bigint }>
    >`
      SELECT o.id, o.name, o.created_at, o.monitoring_paused_at,
        (SELECT count(*) FROM brands b WHERE b.organization_id = o.id AND b.monitoring_paused_at IS NOT NULL) AS paused_brands,
        (SELECT count(*) FROM memberships m WHERE m.organization_id = o.id) AS members,
        (SELECT count(*) FROM brands b WHERE b.organization_id = o.id) AS brands,
        (SELECT count(*) FROM findings f JOIN brands b ON b.id = f.brand_id WHERE b.organization_id = o.id) AS findings,
        (SELECT count(*) FROM scans s JOIN findings f ON f.id = s.finding_id JOIN brands b ON b.id = f.brand_id
           WHERE b.organization_id = o.id AND s.started_at >= ${since}) AS scans_month,
        (SELECT count(*) FROM alert_deliveries d JOIN findings f ON f.id = d.finding_id JOIN brands b ON b.id = f.brand_id
           WHERE b.organization_id = o.id AND d.channel = 'email' AND d.status = 'sent' AND d.created_at >= ${since}) AS emails_month,
        (SELECT max(se.last_seen_at) FROM sessions se JOIN memberships m ON m.user_id = se.user_id WHERE m.organization_id = o.id) AS last_active,
        (SELECT coalesce(sum(u.count), 0) FROM brand_usage u JOIN brands b ON b.id = u.brand_id
           WHERE b.organization_id = o.id AND u.provider = 'tavily' AND u.period = ${tavilyPeriod()}) AS tavily_month
      FROM organizations o
      ORDER BY o.created_at`;
    const [users, tavily] = await Promise.all([
      adminPrisma.user.count(),
      adminPrisma.providerUsage.findUnique({ where: { provider_period: { provider: "tavily", period: tavilyPeriod() } } }),
    ]);
    return {
      month: tavilyPeriod(),
      totals: {
        orgs: orgs.length,
        users,
        brands: orgs.reduce((a, o) => a + n(o.brands), 0),
        monitoredBrands: orgs.reduce((a, o) => a + (o.monitoring_paused_at ? 0 : n(o.brands) - n(o.paused_brands)), 0),
        scansThisMonth: orgs.reduce((a, o) => a + n(o.scans_month), 0),
        emailsThisMonth: orgs.reduce((a, o) => a + n(o.emails_month), 0),
        tavilyThisMonth: tavily?.count ?? 0,
        // Searches made before per-brand counting started (or for since-deleted brands).
        tavilyUnattributed: Math.max(0, (tavily?.count ?? 0) - orgs.reduce((a, o) => a + n(o.tavily_month), 0)),
        tavilyCap: env.tavilyMonthlyCap,
      },
      orgs: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        createdAt: o.created_at,
        pausedAt: o.monitoring_paused_at,
        pausedBrands: n(o.paused_brands),
        members: n(o.members),
        brands: n(o.brands),
        findings: n(o.findings),
        scansThisMonth: n(o.scans_month),
        emailsThisMonth: n(o.emails_month),
        tavilyThisMonth: n(o.tavily_month),
        lastActiveAt: o.last_active,
      })),
    };
  });

  app.get("/api/admin/orgs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await adminPrisma.organization.findUnique({ where: { id } });
    if (!org) return reply.status(404).send({ error: "not_found" });
    const since = monthStart();
    const [members, brands, invites] = await Promise.all([
      adminPrisma.membership.findMany({
        where: { organizationId: id },
        include: { user: { include: { auth: true, sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 } } } },
        orderBy: { createdAt: "asc" },
      }),
      adminPrisma.$queryRaw<Array<{ id: string; name: string; primary_domain: string; created_at: Date; monitoring_paused_at: Date | null; monitoring_paused_by: string | null; findings: bigint; scans_month: bigint; emails_month: bigint; last_scan: Date | null; tavily_month: bigint }>>`
        SELECT b.id, b.name, b.primary_domain, b.created_at, b.monitoring_paused_at, b.monitoring_paused_by,
          (SELECT count(*) FROM findings f WHERE f.brand_id = b.id) AS findings,
          (SELECT count(*) FROM scans s JOIN findings f ON f.id = s.finding_id WHERE f.brand_id = b.id AND s.started_at >= ${since}) AS scans_month,
          (SELECT count(*) FROM alert_deliveries d JOIN findings f ON f.id = d.finding_id
             WHERE f.brand_id = b.id AND d.channel = 'email' AND d.status = 'sent' AND d.created_at >= ${since}) AS emails_month,
          (SELECT max(s.started_at) FROM scans s JOIN findings f ON f.id = s.finding_id WHERE f.brand_id = b.id) AS last_scan,
          (SELECT coalesce(sum(u.count), 0) FROM brand_usage u WHERE u.brand_id = b.id AND u.provider = 'tavily' AND u.period = ${tavilyPeriod()}) AS tavily_month
        FROM brands b WHERE b.organization_id = ${id} ORDER BY b.created_at`,
      adminPrisma.authToken.findMany({
        where: { purpose: "invite", organizationId: id, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      org: { id: org.id, name: org.name, createdAt: org.createdAt, pausedAt: org.monitoringPausedAt, pausedBy: org.monitoringPausedBy },
      members: members.map((m) => ({
        userId: m.userId,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        joinedAt: m.createdAt,
        totpEnabled: !!m.user.auth?.totpEnabledAt,
        hasPassword: !!m.user.auth?.passwordHash,
        googleLinked: !!m.user.auth?.googleSub,
        lastActiveAt: m.user.sessions[0]?.lastSeenAt ?? null,
      })),
      brands: brands.map((b) => ({
        id: b.id,
        name: b.name,
        primaryDomain: b.primary_domain,
        createdAt: b.created_at,
        pausedAt: b.monitoring_paused_at,
        pausedBy: b.monitoring_paused_by,
        findings: n(b.findings),
        scansThisMonth: n(b.scans_month),
        emailsThisMonth: n(b.emails_month),
        tavilyThisMonth: n(b.tavily_month),
        lastScanAt: b.last_scan,
      })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt })),
    };
  });

  // Only platform admins create organizations. The admin doesn't join it; they invite its owner.
  app.post("/api/admin/orgs", async (request, reply) => {
    const parsed = CreateOrgSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const admin = await adminOf(request);
    const org = await createOrganization(parsed.data.name);
    await recordAdminAction(admin, "org.create", { type: "org", id: org.id }, { name: org.name });
    return reply.status(201).send(org);
  });

  // Invite someone into any organization (normally its first owner).
  app.post("/api/admin/orgs/:id/invites", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = InviteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const org = await adminPrisma.organization.findUnique({ where: { id } });
    if (!org) return reply.status(404).send({ error: "not_found" });
    const email = normalizeEmail(parsed.data.email);
    const existing = await adminPrisma.user.findUnique({ where: { email } });
    if (existing && (await adminPrisma.membership.findUnique({ where: { userId_organizationId: { userId: existing.id, organizationId: id } } }))) {
      return reply.status(409).send({ error: "already_member" });
    }
    const admin = await adminOf(request);
    await revokeTokens({ purpose: "invite", organizationId: id, email });
    const token = await issueToken("invite", { email, organizationId: id, role: parsed.data.role, createdBy: admin.userId });
    try {
      await sendInviteEmail(email, token, org.name, admin.email, parsed.data.role);
    } catch (err) {
      request.log.error({ err }, "admin invite email failed");
      await revokeTokens({ purpose: "invite", organizationId: id, email });
      return reply.status(502).send({ error: "email_failed" });
    }
    await recordAdminAction(admin, "org.invite_owner", { type: "org", id }, { email, role: parsed.data.role });
    return reply.status(201).send({ email, role: parsed.data.role });
  });

  app.delete("/api/admin/orgs/:id/invites/:inviteId", async (request, reply) => {
    const { id, inviteId } = request.params as { id: string; inviteId: string };
    const { count } = await adminPrisma.authToken.updateMany({
      where: { id: inviteId, purpose: "invite", organizationId: id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });

  // Pause/resume monitoring (lib/monitoredBrands.ts). Data is kept; jobs and manual triggers
  // skip paused brands. The change and its audit row commit together.
  for (const action of ["pause", "resume"] as const) {
    app.post(`/api/admin/orgs/:id/${action}`, async (request, reply) => {
      const { id } = request.params as { id: string };
      const admin = await adminOf(request);
      const done = await adminPrisma.$transaction(async (tx) => {
        const org = await tx.organization.findUnique({ where: { id } });
        if (!org) return null;
        await tx.organization.update({
          where: { id },
          data: action === "pause" ? { monitoringPausedAt: new Date(), monitoringPausedBy: admin.email } : { monitoringPausedAt: null, monitoringPausedBy: null },
        });
        await recordAdminAction(admin, action === "pause" ? "org.pause" : "org.resume", { type: "org", id }, { name: org.name }, tx);
        return org;
      });
      if (!done) return reply.status(404).send({ error: "not_found" });
      return reply.status(204).send();
    });

    app.post(`/api/admin/brands/:id/${action}`, async (request, reply) => {
      const { id } = request.params as { id: string };
      const admin = await adminOf(request);
      const done = await adminPrisma.$transaction(async (tx) => {
        const brand = await tx.brand.findUnique({ where: { id }, include: { organization: { select: { name: true } } } });
        if (!brand) return null;
        await tx.brand.update({
          where: { id },
          data: action === "pause" ? { monitoringPausedAt: new Date(), monitoringPausedBy: admin.email } : { monitoringPausedAt: null, monitoringPausedBy: null },
        });
        await recordAdminAction(admin, action === "pause" ? "brand.pause" : "brand.resume", { type: "brand", id }, { brand: brand.name, org: brand.organization.name }, tx);
        return brand;
      });
      if (!done) return reply.status(404).send({ error: "not_found" });
      return reply.status(204).send();
    });
  }

  // Read-only view into any org: the normal app, as a viewer, every write refused (lib/auth.ts).
  app.post("/api/admin/orgs/:id/view", async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await adminPrisma.organization.findUnique({ where: { id } });
    if (!org) return reply.status(404).send({ error: "not_found" });
    await startAdminView(request.user!.sessionId, await adminOf(request), { id: org.id, name: org.name });
    return reply.status(204).send();
  });

  // ---- Automatic takedown reporting (lib/takedownAutomation.ts). Allowing it says the admin has
  // checked the org's authorization record; it can't be allowed without one in force. Both the
  // admin audit log and the org's own automation history get a row.

  app.get("/api/admin/orgs/:id/auto-takedown", async (request, reply) => {
    const { id } = request.params as { id: string };
    const org = await adminPrisma.organization.findUnique({ where: { id }, select: { autoTakedownAllowedAt: true, autoTakedownAllowedBy: true } });
    if (!org) return reply.status(404).send({ error: "not_found" });
    const [state, sender, automation, authorizations, brands] = await Promise.all([
      loadAutomationState(adminPrisma, id),
      adminPrisma.takedownSender.findUnique({
        where: { organizationId: id },
        select: { provider: true, fromAddress: true, fromName: true, lastTestAt: true, lastTestOk: true, lastTestError: true, updatedAt: true },
      }),
      adminPrisma.takedownAutomation.findUnique({ where: { organizationId: id } }),
      adminPrisma.takedownAuthorization.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: "desc" },
        include: { documents: { select: { id: true, kind: true, filename: true, sizeBytes: true, sha256: true, uploadedBy: true, createdAt: true } } },
      }),
      adminPrisma.brand.findMany({ where: { organizationId: id }, select: { id: true, name: true } }),
    ]);
    return {
      platformEnabled: env.autoTakedownEnabled,
      allowedAt: org.autoTakedownAllowedAt,
      allowedBy: org.autoTakedownAllowedBy,
      blockers: automationBlockers(state),
      sender,
      automation,
      authorizations: authorizations.map((a) => ({ ...a, brandName: a.brandId ? (brands.find((b) => b.id === a.brandId)?.name ?? null) : null })),
    };
  });

  app.get("/api/admin/orgs/:id/takedown-documents/:docId", async (request, reply) => {
    const { id, docId } = request.params as { id: string; docId: string };
    const doc = await adminPrisma.takedownDocument.findFirst({ where: { id: docId, organizationId: id } });
    if (!doc) return reply.status(404).send({ error: "not_found" });
    return reply
      .header("Content-Type", doc.contentType)
      .header("Content-Disposition", `attachment; filename="${doc.filename.replace(/[^A-Za-z0-9._ -]/g, "_")}"`)
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .send(Buffer.from(doc.data));
  });

  for (const action of ["allow", "disallow"] as const) {
    app.post(`/api/admin/orgs/:id/auto-takedown/${action}`, async (request, reply) => {
      const { id } = request.params as { id: string };
      const admin = await adminOf(request);
      const result = await adminPrisma.$transaction(async (tx) => {
        const org = await tx.organization.findUnique({ where: { id } });
        if (!org) return "not_found" as const;
        if (action === "allow") {
          const state = await loadAutomationState(tx, id);
          if (automationBlockers(state).includes("no_authorization")) return "no_authorization" as const;
        }
        await tx.organization.update({
          where: { id },
          data: action === "allow" ? { autoTakedownAllowedAt: new Date(), autoTakedownAllowedBy: admin.email } : { autoTakedownAllowedAt: null, autoTakedownAllowedBy: null },
        });
        await recordAdminAction(admin, action === "allow" ? "org.auto_takedown_allow" : "org.auto_takedown_disallow", { type: "org", id }, { name: org.name }, tx);
        await recordAutomationEvent(tx, id, { userId: null, email: `platform admin (${admin.email})` }, action === "allow" ? "platform.allow" : "platform.disallow");
        return "ok" as const;
      });
      if (result === "not_found") return reply.status(404).send({ error: "not_found" });
      if (result === "no_authorization") return reply.status(409).send({ error: "no_authorization" });
      return reply.status(204).send();
    });
  }

  // ---- Platform contact book (lib/recipients.ts): shared by every org, overridden by an org's own
  // entry of the same or higher specificity. Audit-logged.

  app.get("/api/admin/contacts", async () => adminPrisma.takedownPlatformContact.findMany({ orderBy: [{ channel: "asc" }, { createdAt: "asc" }] }));

  app.post("/api/admin/contacts", async (request, reply) => {
    const parsed = ContactSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_contact", details: parsed.error.flatten() });
    const admin = await adminOf(request);
    const created = await adminPrisma.$transaction(async (tx) => {
      const row = await tx.takedownPlatformContact.create({ data: { ...parsed.data, updatedBy: admin.email } });
      await recordAdminAction(admin, "platform_contact.create", { type: "contact", id: row.id }, { channel: row.channel, matchType: row.matchType, matchValue: row.matchValue, method: row.method }, tx);
      return row;
    });
    return reply.status(201).send(created);
  });

  app.put("/api/admin/contacts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ContactSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_contact", details: parsed.error.flatten() });
    const admin = await adminOf(request);
    const updated = await adminPrisma.$transaction(async (tx) => {
      const { count } = await tx.takedownPlatformContact.updateMany({ where: { id }, data: { ...parsed.data, updatedBy: admin.email } });
      if (count === 0) return null;
      await recordAdminAction(admin, "platform_contact.update", { type: "contact", id }, { channel: parsed.data.channel, matchValue: parsed.data.matchValue, method: parsed.data.method }, tx);
      return tx.takedownPlatformContact.findUnique({ where: { id } });
    });
    if (!updated) return reply.status(404).send({ error: "not_found" });
    return reply.send(updated);
  });

  app.delete("/api/admin/contacts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const admin = await adminOf(request);
    const done = await adminPrisma.$transaction(async (tx) => {
      const row = await tx.takedownPlatformContact.findUnique({ where: { id } });
      if (!row) return false;
      await tx.takedownPlatformContact.delete({ where: { id } });
      await recordAdminAction(admin, "platform_contact.delete", { type: "contact", id }, { channel: row.channel, matchValue: row.matchValue }, tx);
      return true;
    });
    if (!done) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });

  // ---- User actions. None of them can target the admin's own account (use the account page).

  app.post("/api/admin/users/:id/sign-out", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user!.userId) return reply.status(400).send({ error: "cannot_target_self" });
    const user = await adminPrisma.user.findUnique({ where: { id } });
    if (!user) return reply.status(404).send({ error: "not_found" });
    const admin = await adminOf(request);
    const sessions = await adminPrisma.$transaction(async (tx) => {
      const { count } = await tx.session.deleteMany({ where: { userId: id } });
      await recordAdminAction(admin, "user.sign_out_all", { type: "user", id }, { email: user.email, sessions: count }, tx);
      return count;
    });
    return reply.send({ sessions });
  });

  // Same as `npm run auth:disable-2fa`: for someone who lost both their phone and their codes.
  app.post("/api/admin/users/:id/reset-2fa", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user!.userId) return reply.status(400).send({ error: "cannot_target_self" });
    const user = await adminPrisma.user.findUnique({ where: { id }, include: { auth: true } });
    if (!user) return reply.status(404).send({ error: "not_found" });
    if (!user.auth?.totpEnabledAt && !user.auth?.totpSecretEnc) return reply.status(400).send({ error: "totp_not_enabled" });
    const admin = await adminOf(request);
    await adminPrisma.$transaction(async (tx) => {
      await tx.userAuth.update({ where: { userId: id }, data: TOTP_OFF });
      await tx.session.deleteMany({ where: { userId: id } });
      await recordAdminAction(admin, "user.reset_2fa", { type: "user", id }, { email: user.email }, tx);
    });
    return reply.status(204).send();
  });

  // A 7-day set-password link by email; their current password keeps working until it's used.
  app.post("/api/admin/users/:id/password-link", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user!.userId) return reply.status(400).send({ error: "cannot_target_self" });
    const user = await adminPrisma.user.findUnique({ where: { id } });
    if (!user) return reply.status(404).send({ error: "not_found" });
    const admin = await adminOf(request);
    await revokeTokens({ purpose: "reset_password", userId: id });
    const token = await issueToken("reset_password", { userId: id, email: user.email }, 7 * 24 * 60 * 60 * 1000);
    try {
      await sendAdminPasswordLinkEmail(user.email, token);
    } catch (err) {
      request.log.error({ err }, "admin password-link email failed");
      await revokeTokens({ purpose: "reset_password", userId: id });
      return reply.status(502).send({ error: "email_failed" });
    }
    await recordAdminAction(admin, "user.send_password_link", { type: "user", id }, { email: user.email });
    return reply.status(204).send();
  });

  // Refused when it would leave the org without an owner. Their assignments in that org are
  // cleared, and sessions pointing at it lose it as the active org.
  app.delete("/api/admin/orgs/:id/members/:userId", async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const admin = await adminOf(request);
    const result = await adminPrisma.$transaction(async (tx) => {
      const m = await tx.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: id } }, include: { user: true, organization: true } });
      if (!m) return "not_found" as const;
      if (m.role === "owner" && (await tx.membership.count({ where: { organizationId: id, role: "owner" } })) <= 1) return "last_owner" as const;
      await tx.finding.updateMany({ where: { assigneeId: userId, brand: { organizationId: id } }, data: { assigneeId: null } });
      await tx.membership.delete({ where: { id: m.id } });
      await tx.session.updateMany({ where: { userId, activeOrgId: id }, data: { activeOrgId: null } });
      await recordAdminAction(admin, "user.remove_from_org", { type: "user", id: userId }, { email: m.user.email, org: m.organization.name, role: m.role }, tx);
      return "ok" as const;
    });
    if (result === "not_found") return reply.status(404).send({ error: "not_found" });
    if (result === "last_owner") return reply.status(409).send({ error: "last_owner" });
    return reply.status(204).send();
  });

  // Removes the account: memberships, sessions, credentials, pending tokens. Their notes and
  // takedown records stay (no author shown); assignments are cleared. Refused for another
  // platform admin (revoke with the script first) and for an org's only owner.
  app.delete("/api/admin/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (id === request.user!.userId) return reply.status(400).send({ error: "cannot_target_self" });
    const user = await adminPrisma.user.findUnique({ where: { id }, include: { memberships: { include: { organization: true } } } });
    if (!user) return reply.status(404).send({ error: "not_found" });
    if (user.platformRole) return reply.status(409).send({ error: "is_platform_admin" });
    const soleOwnerOf: string[] = [];
    for (const m of user.memberships.filter((m) => m.role === "owner")) {
      if ((await adminPrisma.membership.count({ where: { organizationId: m.organizationId, role: "owner" } })) <= 1) soleOwnerOf.push(m.organization.name);
    }
    if (soleOwnerOf.length) return reply.status(409).send({ error: "last_owner", orgs: soleOwnerOf });
    const admin = await adminOf(request);
    await adminPrisma.$transaction(async (tx) => {
      await tx.finding.updateMany({ where: { assigneeId: id }, data: { assigneeId: null } });
      await tx.membership.deleteMany({ where: { userId: id } });
      await tx.authToken.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } }); // sessions and user_auth cascade
      await recordAdminAction(admin, "user.delete", { type: "user", id }, { email: user.email, orgs: user.memberships.map((m) => `${m.organization.name} (${m.role})`) }, tx);
    });
    return reply.status(204).send();
  });

  // Deletes the org and everything in it (admin/deleteOrg.ts). The admin types the org's
  // exact name to confirm; the audit row keeps the name and counts.
  app.delete("/api/admin/orgs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const confirmName = String((request.body as { confirmName?: unknown } | undefined)?.confirmName ?? "").trim();
    const org = await adminPrisma.organization.findUnique({ where: { id } });
    if (!org) return reply.status(404).send({ error: "not_found" });
    if (confirmName !== org.name.trim()) return reply.status(400).send({ error: "confirm_mismatch" });
    const admin = await adminOf(request);
    const result = await deleteOrganization(id, (tx, r) =>
      recordAdminAction(admin, "org.delete", { type: "org", id }, { name: r.name, brands: r.brands, findings: r.findings, scans: r.scans, deletedUsers: r.deletedUsers }, tx)
    );
    if (!result) return reply.status(404).send({ error: "not_found" });
    return reply.send(result);
  });

  // Every user, with their orgs, sign-in methods and last activity.
  app.get("/api/admin/users", async () => {
    const users = await adminPrisma.user.findMany({
      include: {
        auth: true,
        memberships: { include: { organization: { select: { id: true, name: true } } } },
        sessions: { select: { lastSeenAt: true }, orderBy: { lastSeenAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "asc" },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      platformRole: u.platformRole,
      createdAt: u.createdAt,
      hasPassword: !!u.auth?.passwordHash,
      totpEnabled: !!u.auth?.totpEnabledAt,
      googleLinked: !!u.auth?.googleSub,
      lastActiveAt: u.sessions[0]?.lastSeenAt ?? null,
      orgs: u.memberships.map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role })),
    }));
  });

  // ---- Access requests from new organizations (public form, routes/accessRequests.ts).

  app.get("/api/admin/access-requests", async () => adminPrisma.accessRequest.findMany({ orderBy: { createdAt: "desc" }, take: 500 }));

  app.post("/api/admin/access-requests/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ status: z.enum(ACCESS_REQUEST_STATUSES) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const { status } = parsed.data;
    const admin = await adminOf(request);
    const updated = await adminPrisma.$transaction(async (tx) => {
      const row = await tx.accessRequest.findUnique({ where: { id } });
      if (!row) return null;
      const done = status !== "new";
      const saved = await tx.accessRequest.update({
        where: { id },
        data: { status, handledBy: done ? admin.email : null, handledAt: done ? new Date() : null },
      });
      await recordAdminAction(admin, "access_request.update", { type: "access_request", id }, { organization: row.organization, email: row.email, status }, tx);
      return saved;
    });
    if (!updated) return reply.status(404).send({ error: "not_found" });
    return reply.send(updated);
  });

  app.get("/api/admin/audit", async (request) => {
    const q = request.query as { before?: string; limit?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const before = q.before ? new Date(q.before) : undefined;
    return adminPrisma.adminAuditLog.findMany({
      where: before && !isNaN(before.getTime()) ? { createdAt: { lt: before } } : {},
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  });
}
