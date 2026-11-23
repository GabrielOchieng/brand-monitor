import type { FastifyReply, FastifyRequest } from "fastify";
import { findSession } from "../auth/sessions";
import { adminPrisma } from "../adminDb";
import { withTenant } from "./tenant";

// The app's 4-tier role model, stored in our `memberships` table.
export const VALID_ROLES = ["owner", "admin", "analyst", "viewer"] as const;
export type Role = (typeof VALID_ROLES)[number];

declare module "fastify" {
  interface FastifyRequest {
    // Set by authenticateUser (no org needed: /auth/me, switching or creating an org).
    user?: { userId: string; sessionId: string; activeOrgId: string | null; adminViewOrgId: string | null };
    // Set by authenticate: a signed-in user acting inside their active organization.
    auth?: {
      userId: string;
      orgId: string;
      role: Role;
      sessionId: string;
      // A platform admin's read-only view (no membership; every write is refused).
      adminView?: boolean;
    };
  }
}

// The session cookie (auth/sessions.ts) identifies the user. Most routes want `authenticate`
// below instead, which also requires an active organization.
export async function authenticateUser(request: FastifyRequest, reply: FastifyReply) {
  const session = await findSession(request);
  if (!session) {
    return reply.status(401).send({ error: "unauthorized", message: "Sign in to continue" });
  }
  request.user = { userId: session.userId, sessionId: session.id, activeOrgId: session.activeOrgId, adminViewOrgId: session.adminViewOrgId };
}

// Attach as a preHandler on any route that needs a signed-in user with an active
// organization. `withTenant`, not a direct/admin query, for the membership read:
// `memberships` has FORCE ROW LEVEL SECURITY. No membership row means the user was removed
// from that org (or it was never theirs): fail closed.
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  await authenticateUser(request, reply);
  if (reply.sent || !request.user) return;
  const { userId, sessionId, activeOrgId, adminViewOrgId } = request.user;

  // Platform admin viewing an org read-only: that org, role viewer, no membership needed, and
  // every write refused here -- for every route that uses authenticate, whatever its own role
  // checks -- so "see but never edit" can't depend on a UI button being hidden. Re-checked on
  // every request: losing the admin role (or 2FA) ends the view.
  if (adminViewOrgId) {
    const viewer = await adminPrisma.user.findUnique({ where: { id: userId }, include: { auth: true } });
    if (viewer?.platformRole && viewer.auth?.totpEnabledAt) {
      if (!["GET", "HEAD"].includes(request.method)) {
        return reply.status(403).send({ error: "admin_read_only", message: "Read-only admin view: exit it to make changes" });
      }
      request.auth = { userId, orgId: adminViewOrgId, role: "viewer", sessionId, adminView: true };
      return;
    }
    await adminPrisma.session.update({ where: { id: sessionId }, data: { adminViewOrgId: null } });
  }

  if (!activeOrgId) {
    return reply.status(403).send({ error: "no_active_organization", message: "Select an organization to continue" });
  }
  const membership = await withTenant(activeOrgId, (tx) =>
    tx.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: activeOrgId } } })
  );
  if (!membership) {
    return reply.status(403).send({ error: "no_active_organization", message: "Select an organization to continue" });
  }
  request.auth = { userId, orgId: activeOrgId, role: membership.role as Role, sessionId };
}

// The admin panel (routes/admin.ts): a session whose user has a platform role, AND has 2FA on.
// An admin account reaches every organization, so a password alone isn't enough. Sets
// request.user like authenticateUser.
export async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply) {
  await authenticateUser(request, reply);
  if (reply.sent || !request.user) return;
  const user = await adminPrisma.user.findUnique({ where: { id: request.user.userId }, include: { auth: true } });
  if (!user?.platformRole) {
    return reply.status(403).send({ error: "forbidden", message: "Platform admins only" });
  }
  if (!user.auth?.totpEnabledAt) {
    return reply.status(403).send({ error: "admin_requires_2fa", message: "Turn on two-factor sign-in to use the admin panel" });
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
