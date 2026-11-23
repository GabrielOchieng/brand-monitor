import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// DELIBERATE, NARROW RLS bypass -- connects as the migration role, not brandmonitor_app.
// Used ONLY by:
//   1. Auth (src/auth/*, src/routes/auth.ts, the invite routes in src/routes/members.ts):
//      sign-in, sessions and invites run before any tenant context exists (a signing-in
//      user has no org yet; a new org has no row to point app.current_org_id at). The
//      credential tables (user_auth, sessions, auth_tokens) are reachable ONLY this way --
//      the app role has no grants on them.
//   2. The scheduled queue dispatchers (src/queue/dispatch.ts): "find every brand due
//      for discovery" / "every finding due for recheck" is inherently cross-tenant --
//      no single request context could ever express it. Kept to narrow, read-only,
//      id-only selects there; the actual per-brand/per-finding work is still done via
//      withTenant() once the dispatcher knows which org it's dealing with.
// Do not import this anywhere else -- request-handling routes and pipeline job handlers
// must go through withTenant() (src/lib/tenant.ts) and the restricted client in src/db.ts.
export const adminPrisma = new PrismaClient({
  datasources: { db: { url: env.databaseUrl } },
});
