import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";

const UpsertSchema = z.object({
  url: z.string().url(),
  enabled: z.boolean().default(true),
});

// Minimal API, no settings UI yet (same deliberate cut as alert rules) -- an org wires
// this up via a direct API call for now; Slack/Teams/Zapier-style receivers can be
// pointed at this without any native integration.
export async function webhookConfigRoutes(app: FastifyInstance) {
  app.get("/api/webhook-config", { preHandler: authenticate }, async (request, reply) => {
    const config = await withTenant(request.auth!.orgId, (tx) =>
      tx.webhookConfig.findUnique({ where: { organizationId: request.auth!.orgId } })
    );
    return reply.send(config);
  });

  app.put(
    "/api/webhook-config",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const parsed = UpsertSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const orgId = request.auth!.orgId;

      const config = await withTenant(orgId, (tx) =>
        tx.webhookConfig.upsert({
          where: { organizationId: orgId },
          create: { organizationId: orgId, url: parsed.data.url, enabled: parsed.data.enabled, secret: crypto.randomBytes(32).toString("hex") },
          update: { url: parsed.data.url, enabled: parsed.data.enabled },
        })
      );
      return reply.send(config);
    }
  );
}
