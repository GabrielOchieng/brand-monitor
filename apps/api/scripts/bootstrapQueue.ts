// One-time-per-environment deploy step (same category as `prisma migrate deploy`) --
// NOT part of the running app. Creates pg-boss's own internal `pgboss` schema/tables
// under the privileged migration role, then grants the restricted runtime role
// (brandmonitor_app) narrow CRUD on just that schema. Deliberately not solved by
// granting brandmonitor_app CREATE ON DATABASE -- that would be DB-wide and permanent,
// inconsistent with the narrow role Stage A built (see prisma/migrations/
// 20260910000000_multi_tenancy_rls/migration.sql). Re-run only when a pg-boss version
// upgrade ships an internal schema migration (pg-boss tracks its own schema version).
import { PgBoss } from "pg-boss";
import { PrismaClient } from "@prisma/client";
import { env } from "../src/env";

async function main() {
  const boss = new PgBoss(env.databaseUrl);
  await boss.start();
  await boss.stop({ graceful: true, close: true });

  const prisma = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });
  try {
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA pgboss TO brandmonitor_app`);
    await prisma.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO brandmonitor_app`
    );
    await prisma.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO brandmonitor_app`);
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brandmonitor_app`
    );
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT USAGE, SELECT ON SEQUENCES TO brandmonitor_app`
    );
    console.log("pg-boss schema bootstrapped; brandmonitor_app granted narrow access to it.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
