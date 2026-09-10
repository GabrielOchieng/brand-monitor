import type { FastifyInstance } from "fastify";
import { authenticate } from "../lib/auth";
import { withTenant } from "../lib/tenant";

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
}
