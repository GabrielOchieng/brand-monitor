import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyToken } from "@clerk/backend";
import { env } from "../env";
import { withTenant } from "./tenant";

// This app's own 4-tier role model -- lives entirely in our Postgres `memberships` table
// now, NOT in Clerk. Originally these were configured as Clerk custom org roles and read
// straight off the session JWT, but Clerk only offers custom roles on a PRODUCTION
// instance behind a paid "B2B Authentication" add-on ($100/mo) -- free only in
// development. Since this app must run at $0, Clerk is used only for identity (user id)
// and org-membership existence (both free, unaffected by that paywall); role storage and
// management is entirely app-owned -- see routes/webhooks.ts (initial role assignment on
// membership creation) and routes/members.ts (the PATCH endpoint that changes it
// afterward). This also means Clerk's own dashboard role toggle (Admin/Member) has no
// effect on this app any more -- see DEPLOYMENT.md's Clerk section.
export const VALID_ROLES = ["owner", "admin", "analyst", "viewer"] as const;

declare module "fastify" {
  interface FastifyRequest {
    auth?: {
      userId: string;
      orgId: string;
      role: string;
    };
  }
}

// Attach as a preHandler on any route that needs a signed-in user with an active
// organization. Clerk's JWT still supplies userId/orgId (identity + org-membership
// existence -- both free, core features), but role now comes from our own DB, not the
// token -- see the VALID_ROLES comment above for why. `withTenant`, not a direct/admin
// query, is required here: `memberships` has FORCE ROW LEVEL SECURITY (see db.ts's own
// header comment), so a bare `prisma.membership.findUnique` would silently return null
// (no RLS session var set), and `adminPrisma` is reserved for pre-tenant-context
// bootstrapping only, never per-request reads.
//
// Clerk's current ("v2", claims.v === 2) session token nests org info under a short
// `o` claim -- `o.id` / `o.slg` -- not a flat `org_id` claim (which is what Clerk's own
// docs examples often still show; verified empirically against a real token here, not
// assumed from docs).
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return reply.status(401).send({ error: "unauthorized", message: "Missing bearer token" });
  }

  try {
    const claims = await verifyToken(token, { secretKey: env.clerkSecretKey });
    const org = (claims as any).o as { id?: string } | undefined;
    const orgId = org?.id ?? (claims as any).org_id;
    if (!orgId) {
      return reply.status(403).send({ error: "no_active_organization", message: "Select an organization to continue" });
    }
    // Fallback "viewer" on no row covers a narrow, self-healing, fail-CLOSED race: a
    // brand-new org's membership webhook hasn't landed yet when the creator's very first
    // API call arrives. Resolves itself within seconds once the webhook catches up.
    const membership = await withTenant(orgId, (tx) =>
      tx.membership.findUnique({ where: { userId_organizationId: { userId: claims.sub, organizationId: orgId } } })
    );
    request.auth = { userId: claims.sub, orgId, role: membership?.role ?? "viewer" };
  } catch {
    return reply.status(401).send({ error: "unauthorized", message: "Invalid or expired token" });
  }
}

// Compose after `authenticate` on routes that need a specific role, e.g.:
//   app.post("/api/brands", { preHandler: [authenticate, requireRole("owner", "admin")] }, handler)
export function requireRole(...allowed: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth || !allowed.includes(request.auth.role)) {
      return reply.status(403).send({ error: "forbidden", message: `Requires role: ${allowed.join(" or ")}` });
    }
  };
}
