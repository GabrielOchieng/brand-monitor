import type { FastifyInstance } from "fastify";
import { Webhook } from "svix";
import { env } from "../env";
import { adminPrisma } from "../adminDb";

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
          await adminPrisma.alertRule.upsert({
            where: { id: `default-website-activated-${id}` },
            create: {
              id: `default-website-activated-${id}`,
              organizationId: id,
              kind: "website_activated",
              config: {},
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
          const { organization, public_user_data } = event.data;
          // Role is app-owned now, not Clerk-derived (see lib/auth.ts's VALID_ROLES
          // comment) -- Clerk's own `role` field here is just its built-in org:admin /
          // org:member default and is intentionally ignored. `update: {}` for BOTH event
          // types, unconditionally: role must only ever be written in `create`, never in
          // `update`, so a redelivered `.created` (svix can retry) can't ever re-derive
          // and overwrite an already-assigned role -- write-once by construction, not by
          // hoping the derivation happens to be idempotent.
          //
          // organization.created_by (present on the Organization resource, including
          // nested here) identifies the org creator race-free -- a naive "count existing
          // memberships, 0 means creator" check has a real TOCTOU gap if two membership
          // events land concurrently (e.g. an invite sent moments after org creation).
          // Falls back to that count only if created_by is ever missing/null; that
          // fallback's own narrow race is accepted as self-healing, not fixed, since a
          // wrongly-assigned first owner is correctable via the /team page's role PATCH.
          // TODO(verify): this event's `organization.created_by` shape hasn't yet been
          // confirmed against a real live payload -- check real Render logs on first
          // signup (see plan's verification section) the same way auth.ts's own JWT
          // shape comment documents having done for `o.id`.
          const isCreator =
            organization.created_by != null
              ? organization.created_by === public_user_data.user_id
              : (await adminPrisma.membership.count({ where: { organizationId: organization.id } })) === 0;
          // Clerk doesn't guarantee this event arrives after a `user.created` for the same
          // person -- confirmed for real via a live P2003 (memberships_user_id_fkey)
          // failure on Render: a membership event landed for a user whose own
          // user.created/.updated was never delivered to this endpoint (created before the
          // webhook existed). Upsert a minimal User row first so the FK is always
          // satisfied regardless of delivery order; `update: {}` here (not overwriting
          // email/name) leaves user.created/.updated as the authoritative, richer source
          // whenever it does arrive.
          await adminPrisma.user.upsert({
            where: { id: public_user_data.user_id },
            create: {
              id: public_user_data.user_id,
              email: public_user_data.identifier ?? `${public_user_data.user_id}@unknown.local`,
              name: [public_user_data.first_name, public_user_data.last_name].filter(Boolean).join(" ") || null,
            },
            update: {},
          });
          await adminPrisma.membership.upsert({
            where: { userId_organizationId: { userId: public_user_data.user_id, organizationId: organization.id } },
            create: {
              userId: public_user_data.user_id,
              organizationId: organization.id,
              role: isCreator ? "owner" : "viewer",
            },
            update: {},
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
