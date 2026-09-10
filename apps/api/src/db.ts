import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// Internal only -- route/pipeline code must never import this directly. Every DB access
// from request-handling code goes through withTenant() (see src/lib/tenant.ts), which is
// the only place that's allowed to touch this client, so that setting the RLS session
// variable can never be forgotten. Always connects as the restricted brandmonitor_app
// role (DATABASE_APP_URL), never the migration role.
export const prisma = new PrismaClient({
  datasources: { db: { url: env.databaseAppUrl } },
});
