import type { FastifyInstance } from "fastify";
import { Webhook } from "svix";
import { env } from "../env";
import { adminPrisma } from "../adminDb";
import { normalizeRole } from "../lib/auth";

interface ClerkEvent {
  type: string;
  data: Record<string, any>;
}

// Syncs Clerk -> our own organizations/users/memberships tables. Clerk stays the source
// of truth for auth/roles (see src/lib/auth.ts, which reads org_id/org_role straight off
// the session JWT) -- this table is a local mirror for relational joins and display
// (e.g. listing teammates) so brand/finding rows have a real FK target and RLS policies
// have something to join against, not the authorization mechanism itself.
export async function webhookRoutes(app: FastifyInstance) {
  app.post(
    "/api/webhooks/clerk",
    { config: { rawBody: true } },
    async (request, reply) => {
      const svixId = request.headers["svix-id"];
      const svixTimestamp = request.headers["svix-timestamp"];
      const svixSignature = request.headers["svix-signature"];
      if (!svixId || !svixTimestamp || !svixSignature) {
        return reply.status(400).send({ error: "missing_svix_headers" });
      }

      const wh = new Webhook(env.clerkWebhookSigningSecret);
      let event: ClerkEvent;
      try {
        event = wh.verify(request.rawBody as string, {
          "svix-id": svixId as string,
          "svix-timestamp": svixTimestamp as string,
          "svix-signature": svixSignature as string,
        }) as ClerkEvent;
      } catch {
        return reply.status(400).send({ error: "invalid_signature" });
      }

      switch (event.type) {
        case "organization.created":
        case "organization.updated": {
          const { id, name } = event.data;
          await adminPrisma.organization.upsert({
            where: { id },
            create: { id, name },
            update: { name },
          });
          // Default alerting so a new org isn't silently unmonitored -- pre-existing
          // orgs (from before this shipped) are backfilled directly in the migration
          // that introduced alert_rules, not here.
          await adminPrisma.alertRule.upsert({
            where: { id: `default-severity-high-${id}` },
            create: {
              id: `default-severity-high-${id}`,
              organizationId: id,
              kind: "severity_threshold",
              config: { minSeverity: "high" },
              channels: ["email", "in_app"],
            },
            update: {},
          });
          break;
        }
        case "user.created":
        case "user.updated": {
          const { id, email_addresses, first_name, last_name } = event.data;
          const email = email_addresses?.[0]?.email_address ?? `${id}@unknown.local`;
          const name = [first_name, last_name].filter(Boolean).join(" ") || null;
          await adminPrisma.user.upsert({
            where: { id },
            create: { id, email, name },
            update: { email, name },
          });
          break;
        }
        case "organizationMembership.created":
        case "organizationMembership.updated": {
          const { organization, public_user_data, role } = event.data;
          await adminPrisma.membership.upsert({
            where: { userId_organizationId: { userId: public_user_data.user_id, organizationId: organization.id } },
            create: {
              userId: public_user_data.user_id,
              organizationId: organization.id,
              role: normalizeRole(role),
            },
            update: { role: normalizeRole(role) },
          });
          break;
        }
        case "organizationMembership.deleted": {
          const { organization, public_user_data } = event.data;
          await adminPrisma.membership.deleteMany({
            where: { userId: public_user_data.user_id, organizationId: organization.id },
          });
          break;
        }
        default:
          break;
      }

      return reply.send({ received: true });
    }
  );
}
