import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, VALID_ROLES } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { adminPrisma } from "../adminDb";
import { createRateLimiter } from "../lib/rateLimit";
import { normalizeEmail } from "../auth/crypto";
import { issueToken, revokeTokens } from "../auth/tokens";
import { sendInviteEmail } from "../auth/emails";

const PatchMemberRoleSchema = z.object({ role: z.enum(VALID_ROLES) });
const InviteSchema = z.object({ email: z.string().trim().min(3).max(254).email(), role: z.enum(VALID_ROLES) });
const allowInviteForOrg = createRateLimiter(20, 24 * 60 * 60 * 1000);

// Backs the assignee dropdown on a finding's lifecycle controls -- just the current
// org's members.
export async function membersRoutes(app: FastifyInstance) {
  app.get("/api/organization/members", { preHandler: authenticate }, async (request, reply) => {
    const memberships = await withTenant(request.auth!.orgId, (tx) =>
      tx.membership.findMany({ where: { organizationId: request.auth!.orgId }, include: { user: true } })
    );
    return reply.send(
      memberships.map((m) => ({ userId: m.userId, email: m.user.email, role: m.role }))
    );
  });

  // owner-only -- role management is more sensitive than brand management (owner, admin)
  // or finding lifecycle work (owner, admin, analyst): a careless/compromised admin could
  // otherwise grant itself owner.
  app.patch(
    "/api/organization/members/:userId",
    { preHandler: [authenticate, requireRole("owner")] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const parsed = PatchMemberRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      }
      if (userId === request.auth!.userId) {
        return reply.status(400).send({ error: "cannot_change_own_role" });
      }
      const orgId = request.auth!.orgId;
      const { role } = parsed.data;

      const result = await withTenant(orgId, async (tx) => {
        const target = await tx.membership.findFirst({ where: { userId, organizationId: orgId } });
        if (!target) return "not_found" as const;
        if (target.role === "owner" && role !== "owner") {
          const ownerCount = await tx.membership.count({ where: { organizationId: orgId, role: "owner" } });
          if (ownerCount <= 1) return "last_owner" as const;
        }
        await tx.membership.updateMany({ where: { userId, organizationId: orgId }, data: { role } });
        return "ok" as const;
      });

      if (result === "not_found") return reply.status(404).send({ error: "not_found" });
      if (result === "last_owner") return reply.status(400).send({ error: "cannot_demote_last_owner" });
      return reply.send({ userId, role });
    }
  );

  // owner-only, same as role changes. Their sessions stay signed in but lose this org as the
  // active one, so their next request gets no_active_organization instead of this org's data.
  app.delete(
    "/api/organization/members/:userId",
    { preHandler: [authenticate, requireRole("owner")] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      if (userId === request.auth!.userId) return reply.status(400).send({ error: "cannot_remove_self" });
      const orgId = request.auth!.orgId;
      const result = await withTenant(orgId, async (tx) => {
        const target = await tx.membership.findFirst({ where: { userId, organizationId: orgId } });
        if (!target) return "not_found" as const;
        if (target.role === "owner") {
          const ownerCount = await tx.membership.count({ where: { organizationId: orgId, role: "owner" } });
          if (ownerCount <= 1) return "last_owner" as const;
        }
        // Their open assignments go back to the unassigned pool.
        await tx.finding.updateMany({ where: { assigneeId: userId, brand: { organizationId: orgId } }, data: { assigneeId: null } });
        await tx.membership.deleteMany({ where: { userId, organizationId: orgId } });
        return "ok" as const;
      });
      if (result === "not_found") return reply.status(404).send({ error: "not_found" });
      if (result === "last_owner") return reply.status(400).send({ error: "cannot_demote_last_owner" });
      await adminPrisma.session.updateMany({ where: { userId, activeOrgId: orgId }, data: { activeOrgId: null } });
      return reply.status(204).send();
    }
  );

  // Invites are auth_tokens rows (no RLS on that table), so every query here filters on the
  // caller's org explicitly.
  app.get(
    "/api/organization/invites",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const rows = await adminPrisma.authToken.findMany({
        where: { purpose: "invite", organizationId: request.auth!.orgId, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      return reply.send(rows.map((r) => ({ id: r.id, email: r.email, role: r.role, createdAt: r.createdAt, expiresAt: r.expiresAt })));
    }
  );

  // owner or admin; only an owner can invite another owner.
  app.post(
    "/api/organization/invites",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const parsed = InviteSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const { orgId, userId: inviterId, role: inviterRole } = request.auth!;
      const email = normalizeEmail(parsed.data.email);
      const { role } = parsed.data;
      if (role === "owner" && inviterRole !== "owner") return reply.status(403).send({ error: "forbidden" });

      const existing = await adminPrisma.user.findUnique({ where: { email } });
      if (existing) {
        const member = await adminPrisma.membership.findUnique({
          where: { userId_organizationId: { userId: existing.id, organizationId: orgId } },
        });
        if (member) return reply.status(409).send({ error: "already_member" });
      }
      if (!allowInviteForOrg(orgId)) return reply.status(429).send({ error: "too_many_invites" });

      const [org, inviter] = await Promise.all([
        adminPrisma.organization.findUnique({ where: { id: orgId } }),
        adminPrisma.user.findUnique({ where: { id: inviterId } }),
      ]);
      // A new invite to the same address replaces the old one.
      await revokeTokens({ purpose: "invite", organizationId: orgId, email });
      const token = await issueToken("invite", { email, organizationId: orgId, role, createdBy: inviterId });
      try {
        await sendInviteEmail(email, token, org?.name ?? "your team", inviter?.email ?? "A teammate", role);
      } catch (err) {
        request.log.error({ err }, "invite email failed");
        await revokeTokens({ purpose: "invite", organizationId: orgId, email });
        return reply.status(502).send({ error: "email_failed" });
      }
      return reply.status(201).send({ email, role });
    }
  );

  app.delete(
    "/api/organization/invites/:id",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { count } = await adminPrisma.authToken.updateMany({
        where: { id, purpose: "invite", organizationId: request.auth!.orgId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) return reply.status(404).send({ error: "not_found" });
      return reply.status(204).send();
    }
  );
}
