import type { FastifyInstance } from "fastify";
import { adminPrisma } from "../adminDb";
import { env } from "../env";
import { AccessRequestSchema, buildAccessRequestEmail } from "../lib/accessRequests";
import { sendMail } from "../lib/email";
import { verifyTurnstile } from "../lib/publicReports";
import { createRateLimiter } from "../lib/rateLimit";

const perIpLimit = createRateLimiter(3, 60 * 60 * 1000);

// Public, no login: a new organization asking for an account (/request-access). The only other
// unauthenticated write is the scam-report form (publicReports.ts), with the same defences:
// rate limit, honeypot, Turnstile when configured. Saved first, then emailed to every platform
// admin; a failed email still leaves the request in /admin.
export async function accessRequestRoutes(app: FastifyInstance) {
  app.post("/api/public/access-requests", async (request, reply) => {
    if (!perIpLimit(request.ip)) return reply.status(429).send({ error: "too_many_requests" });

    const parsed = AccessRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const input = parsed.data;
    // Bots get the same answer as people, so they don't learn to skip the field.
    if (input.website) return reply.status(201).send({ ok: true });
    if (!(await verifyTurnstile(input.turnstileToken, request.ip))) return reply.status(400).send({ error: "captcha_failed" });

    const saved = await adminPrisma.accessRequest.create({
      data: { name: input.name, email: input.email, organization: input.organization, brands: input.brands, message: input.message || null },
    });

    try {
      const admins = await adminPrisma.user.findMany({ where: { platformRole: { not: null } }, select: { email: true } });
      const email = buildAccessRequestEmail(saved, `${env.webAppUrl}/admin/access-requests`);
      for (const a of admins) await sendMail({ to: a.email, ...email });
    } catch (err) {
      request.log.error({ err, accessRequestId: saved.id }, "access request saved but the admin email failed");
    }

    return reply.status(201).send({ ok: true });
  });
}
