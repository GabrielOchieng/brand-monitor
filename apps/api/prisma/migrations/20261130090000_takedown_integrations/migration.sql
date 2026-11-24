-- Automatic takedown reporting, step 6: report APIs (Cloudflare abuse reports) per org.

-- CreateTable
CREATE TABLE "takedown_integrations" (
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT NOT NULL,
    "public_config" JSONB NOT NULL,
    "last_test_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "last_test_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "takedown_integrations_pkey" PRIMARY KEY ("organization_id","provider")
);


ALTER TABLE "takedown_integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_integrations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_integrations"
  USING ("organization_id" = current_setting('app.current_org_id', true));
