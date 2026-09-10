import type { FastifyInstance } from "fastify";
import { authenticate } from "../lib/auth";
import { withTenant } from "../lib/tenant";

export async function notificationsRoutes(app: FastifyInstance) {
  app.get("/api/notifications", { preHandler: authenticate }, async (request, reply) => {
    const orgId = request.auth!.orgId;
    const [notifications, unreadCount] = await withTenant(orgId, (tx) =>
      Promise.all([
        tx.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
        tx.notification.count({ where: { readAt: null } }),
      ])
    );
    return reply.send({ notifications, unreadCount });
  });

  app.post("/api/notifications/:id/read", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    const updated = await withTenant(orgId, (tx) =>
      tx.notification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } })
    );
    if (updated.count === 0) return reply.status(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  });

  app.post("/api/notifications/read-all", { preHandler: authenticate }, async (request, reply) => {
    const orgId = request.auth!.orgId;
    await withTenant(orgId, (tx) => tx.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } }));
    return reply.send({ ok: true });
  });
}
