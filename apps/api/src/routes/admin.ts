import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { adminPrisma } from "../adminDb";
import { env } from "../env";
import { requirePlatformAdmin, VALID_ROLES } from "../lib/auth";
import { normalizeEmail } from "../auth/crypto";
import { createOrganization } from "../auth/orgs";
import { issueToken, revokeTokens } from "../auth/tokens";
import { sendInviteEmail } from "../auth/emails";
import { recordAdminAction } from "../auth/audit";
import { tavilyPeriod } from "../lib/tavily";

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
  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/api/admin/")) await requirePlatformAdmin(request, reply);
  });

  // Every org with its size, this month's usage and when a member was last active.
  app.get("/api/admin/overview", async () => {
    const since = monthStart();
    const orgs = await adminPrisma.$queryRaw<
      Array<{ id: string; name: string; created_at: Date; monitoring_paused_at: Date | null; paused_brands: bigint; members: bigint; brands: bigint; findings: bigint; scans_month: bigint; emails_month: bigint; last_active: Date | null }>
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
        (SELECT max(se.last_seen_at) FROM sessions se JOIN memberships m ON m.user_id = se.user_id WHERE m.organization_id = o.id) AS last_active
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
      adminPrisma.$queryRaw<Array<{ id: string; name: string; primary_domain: string; created_at: Date; monitoring_paused_at: Date | null; monitoring_paused_by: string | null; findings: bigint; scans_month: bigint; emails_month: bigint; last_scan: Date | null }>>`
        SELECT b.id, b.name, b.primary_domain, b.created_at, b.monitoring_paused_at, b.monitoring_paused_by,
          (SELECT count(*) FROM findings f WHERE f.brand_id = b.id) AS findings,
          (SELECT count(*) FROM scans s JOIN findings f ON f.id = s.finding_id WHERE f.brand_id = b.id AND s.started_at >= ${since}) AS scans_month,
          (SELECT count(*) FROM alert_deliveries d JOIN findings f ON f.id = d.finding_id
             WHERE f.brand_id = b.id AND d.channel = 'email' AND d.status = 'sent' AND d.created_at >= ${since}) AS emails_month,
          (SELECT max(s.started_at) FROM scans s JOIN findings f ON f.id = s.finding_id WHERE f.brand_id = b.id) AS last_scan
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
