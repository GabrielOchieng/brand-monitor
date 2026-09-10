-- Stage A: multi-tenancy tables (users, memberships) + Postgres row-level security.
--
-- IMPORTANT: this migration must run under a privileged/migration-owner Postgres role
-- (the same role `prisma migrate` already connects as). The application's RUNTIME role
-- (brandmonitor_app, created below) must never be granted BYPASSRLS or superuser -- RLS
-- is only a real security boundary if the role the API server connects as cannot simply
-- ignore it. Seed scripts and any future admin tooling should run under the migration
-- role, deliberately, not brandmonitor_app.

-- 1. New tables ---------------------------------------------------------------

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "memberships" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'analyst',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "memberships_user_id_organization_id_key" ON "memberships"("user_id", "organization_id");

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Runtime application role --------------------------------------------------
-- Change the password before deploying anywhere beyond local dev.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'brandmonitor_app') THEN
    CREATE ROLE brandmonitor_app LOGIN PASSWORD 'brandmonitor_app_dev_password'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE brandmonitor TO brandmonitor_app;
GRANT USAGE ON SCHEMA public TO brandmonitor_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brandmonitor_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brandmonitor_app;

-- 3. Row-level security ---------------------------------------------------------
-- current_setting('app.current_org_id', true) returns NULL (not an error) when unset,
-- which correctly denies all rows by default -- code that forgets to call withTenant()
-- sees nothing, never everything. FORCE is a defensive extra: it makes the policy apply
-- even to the table owner, not just other roles (brandmonitor_app is not the owner here,
-- so ENABLE alone would already be sufficient, but this is cheap insurance against a
-- future ownership change silently reopening the hole).

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "organizations"
  USING ("id" = current_setting('app.current_org_id', true));

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("organization_id" = current_setting('app.current_org_id', true));

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "users"
  USING ("id" IN (
    SELECT "user_id" FROM "memberships" WHERE "organization_id" = current_setting('app.current_org_id', true)
  ));

ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brands" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "brands"
  USING ("organization_id" = current_setting('app.current_org_id', true));

-- Reachable only via brand_id -> brands.organization_id
ALTER TABLE "brand_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_domains" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "brand_domains"
  USING ("brand_id" IN (SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)));

ALTER TABLE "brand_keywords" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_keywords" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "brand_keywords"
  USING ("brand_id" IN (SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)));

ALTER TABLE "brand_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_assets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "brand_assets"
  USING ("brand_id" IN (SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)));

ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "findings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "findings"
  USING ("brand_id" IN (SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)));

ALTER TABLE "pipeline_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "pipeline_runs"
  USING ("brand_id" IN (SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)));

-- Reachable only via finding_id -> findings.brand_id -> brands.organization_id
ALTER TABLE "domain_intel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "domain_intel" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "domain_intel"
  USING ("finding_id" IN (
    SELECT "id" FROM "findings" WHERE "brand_id" IN (
      SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
    )
  ));

ALTER TABLE "website_intel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "website_intel" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "website_intel"
  USING ("finding_id" IN (
    SELECT "id" FROM "findings" WHERE "brand_id" IN (
      SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
    )
  ));

ALTER TABLE "finding_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finding_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "finding_evidence"
  USING ("finding_id" IN (
    SELECT "id" FROM "findings" WHERE "brand_id" IN (
      SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
    )
  ));

ALTER TABLE "finding_score_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finding_score_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "finding_score_events"
  USING ("finding_id" IN (
    SELECT "id" FROM "findings" WHERE "brand_id" IN (
      SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
    )
  ));
