import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyToken } from "@clerk/backend";
import { env } from "../env";

// Custom org roles are configured in the Clerk dashboard (Organizations -> Roles) with
// bare keys: owner / admin / analyst / viewer (Clerk namespaces them internally, but
// they come back in the session token without any "org:" prefix -- see below).
const VALID_ROLES = new Set(["owner", "admin", "analyst", "viewer"]);

export function normalizeRole(clerkRole: string | undefined): string {
  const bare = (clerkRole ?? "").replace(/^org:/, "");
  return VALID_ROLES.has(bare) ? bare : "viewer";
}

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
// organization. Reads the Clerk session token's org claims directly -- Clerk is the
// source of truth for membership/role, so no DB round-trip is needed just to establish
// the auth context (our own `memberships` table, synced via webhook, exists for
// convenience/display, not as the authorization check).
//
// Clerk's current ("v2", claims.v === 2) session token nests org info under a short
// `o` claim -- `o.id` / `o.rol` / `o.slg` -- not flat `org_id`/`org_role` claims (which
// is what Clerk's own docs examples often still show; verified empirically against a
// real token here, not assumed from docs).
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return reply.status(401).send({ error: "unauthorized", message: "Missing bearer token" });
  }

  try {
    const claims = await verifyToken(token, { secretKey: env.clerkSecretKey });
    const org = (claims as any).o as { id?: string; rol?: string } | undefined;
    const orgId = org?.id ?? (claims as any).org_id;
    if (!orgId) {
      return reply.status(403).send({ error: "no_active_organization", message: "Select an organization to continue" });
    }
    request.auth = {
      userId: claims.sub,
      orgId,
      role: normalizeRole(org?.rol ?? (claims as any).org_role),
    };
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
