import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole, VALID_ROLES } from "../lib/auth";
import { withTenant } from "../lib/tenant";

const PatchMemberRoleSchema = z.object({ role: z.enum(VALID_ROLES) });

// Backs the assignee dropdown on a finding's lifecycle controls -- just the current
// org's members, synced via the Clerk webhook (see routes/webhooks.ts).
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
  // otherwise grant itself owner. See lib/auth.ts's VALID_ROLES comment for why role lives
  // here at all instead of in Clerk.
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
}
