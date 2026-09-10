import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// DELIBERATE, NARROW RLS bypass -- connects as the migration role, not brandmonitor_app.
// Used ONLY by:
//   1. The Clerk webhook sync (src/routes/webhooks.ts): syncing an organization/user
//      record has to happen before any tenant session context can exist (you can't set
//      app.current_org_id to an org that doesn't have a row yet, and a brand new user
//      isn't a member of anything yet either).
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
