import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { parseSubmittedUrl } from "../lib/submittedUrl";
import { sendWebhook } from "../lib/webhookDelivery";

const UpsertSchema = z.object({
  url: z.string().url(),
  enabled: z.boolean().default(true),
});

// The webhook receiver for alerts (Settings -> Integrations). Slack/Teams/Zapier-style
// receivers can be pointed at it without any native integration. Payloads are signed with
// the org's secret (lib/webhookDelivery.ts), which only owners and admins can see.

function isAdmin(role: string) {
  return role === "owner" || role === "admin";
}

// HTTPS to a public host only: the API posts to this URL from inside the VPS, so a private
// or loopback address would reach internal services.
export function webhookUrlError(raw: string): string | null {
  if (!/^https:\/\//i.test(raw)) return "webhook_https_only";
  const target = parseSubmittedUrl(raw);
  return target.ok ? null : "target_not_allowed";
}

export async function webhookConfigRoutes(app: FastifyInstance) {
  app.get("/api/webhook-config", { preHandler: authenticate }, async (request, reply) => {
    const config = await withTenant(request.auth!.orgId, (tx) => tx.webhookConfig.findUnique({ where: { organizationId: request.auth!.orgId } }));
    if (!config) return reply.send(null);
    // The signing secret is a credential: viewers and analysts see that one exists, not it.
    return reply.send({ ...config, secret: isAdmin(request.auth!.role) ? config.secret : null });
  });

  app.put(
    "/api/webhook-config",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const parsed = UpsertSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const urlError = webhookUrlError(parsed.data.url);
      if (urlError) return reply.status(400).send({ error: urlError });
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

  // A new secret; the receiver has to be updated with it before the next alert.
  app.post(
    "/api/webhook-config/rotate-secret",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const orgId = request.auth!.orgId;
      const updated = await withTenant(orgId, (tx) =>
        tx.webhookConfig.updateMany({ where: { organizationId: orgId }, data: { secret: crypto.randomBytes(32).toString("hex") } })
      );
      if (updated.count === 0) return reply.status(404).send({ error: "not_found" });
      const config = await withTenant(orgId, (tx) => tx.webhookConfig.findUnique({ where: { organizationId: orgId } }));
      return reply.send(config);
    }
  );

  // Sends a clearly-marked sample payload, signed like a real alert, and reports whether
  // the receiver accepted it.
  app.post(
    "/api/webhook-config/test",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const orgId = request.auth!.orgId;
      const config = await withTenant(orgId, (tx) => tx.webhookConfig.findUnique({ where: { organizationId: orgId } }));
      if (!config) return reply.status(404).send({ error: "not_found" });
      const urlError = webhookUrlError(config.url);
      if (urlError) return reply.status(400).send({ error: urlError });
      try {
        await sendWebhook(config.url, config.secret, {
          event: "test",
          test: true,
          message: "Test alert from Brand Monitor. No action needed.",
          sentAt: new Date().toISOString(),
        });
        return reply.send({ ok: true });
      } catch (err: any) {
        return reply.send({ ok: false, error: String(err?.message ?? err).slice(0, 200) });
      }
    }
  );
}
