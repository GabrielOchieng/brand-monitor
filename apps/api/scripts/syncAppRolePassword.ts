// The 20260910000000_multi_tenancy_rls migration always creates brandmonitor_app with its
// own hardcoded dev password (real, necessary: a schema migration can't read env vars at
// apply time) -- every real deployment needs this to bring the role's actual password in
// sync with whatever DATABASE_APP_URL says, or the app fails to authenticate right after
// its first deploy. Idempotent (ALTER ROLE ... WITH PASSWORD unconditionally sets it), so
// safe to run on every boot alongside migrate deploy / queue:bootstrap.
import { PrismaClient } from "@prisma/client";
import { env } from "../src/env";

async function main() {
  if (!env.databaseAppUrl) throw new Error("DATABASE_APP_URL is not set");
  // .password is the raw (still percent-encoded) URL component, not decoded -- a password
  // containing URL-unsafe characters would otherwise get set literally with %-escapes
  // still in it, silently mismatching the real password DATABASE_APP_URL actually uses.
  const password = decodeURIComponent(new URL(env.databaseAppUrl).password);
  if (!password) throw new Error("DATABASE_APP_URL has no password to sync");

  const adminPrisma = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });
  try {
    // Not a bind parameter -- ALTER ROLE ... PASSWORD takes a literal. The value comes
    // from our own DATABASE_APP_URL, never external input, so this is safe.
    await adminPrisma.$executeRawUnsafe(`ALTER ROLE brandmonitor_app WITH PASSWORD '${password.replace(/'/g, "''")}'`);
    console.log("brandmonitor_app password synced with DATABASE_APP_URL.");
  } finally {
    await adminPrisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
