-- Automatic takedown reporting, step 1 (TAKEDOWN_AUTOMATION_PLAN.md): switches, the org's sender
-- mailbox, authorization records + documents, and the org's history of changes.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "auto_takedown_allowed_at" TIMESTAMP(3),
ADD COLUMN     "auto_takedown_allowed_by" TEXT;

-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "auto_takedown_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "takedown_automation" (
    "organization_id" TEXT NOT NULL,
    "enabled_at" TIMESTAMP(3),
    "enabled_by" TEXT,
    "stopped_at" TIMESTAMP(3),
    "stopped_by" TEXT,
    "stop_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "takedown_automation_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "takedown_senders" (
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "from_name" TEXT,
    "reply_to" TEXT,
    "bcc_archive" TEXT,
    "signature" TEXT,
    "config" TEXT NOT NULL,
    "public_config" JSONB NOT NULL,
    "last_test_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "last_test_error" TEXT,
    "last_test_to" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "takedown_senders_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "takedown_authorizations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "signatory_name" TEXT NOT NULL,
    "signatory_title" TEXT NOT NULL,
    "signatory_email" TEXT NOT NULL,
    "signatory_phone" TEXT,
    "scope" TEXT,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "takedown_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takedown_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "authorization_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "takedown_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takedown_automation_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "takedown_automation_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "takedown_authorizations_organization_id_idx" ON "takedown_authorizations"("organization_id");

-- CreateIndex
CREATE INDEX "takedown_documents_authorization_id_idx" ON "takedown_documents"("authorization_id");

-- CreateIndex
CREATE INDEX "takedown_automation_events_organization_id_created_at_idx" ON "takedown_automation_events"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "takedown_documents" ADD CONSTRAINT "takedown_documents_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "takedown_authorizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RLS on organization_id, same shape as webhook_configs. The app role's table grants come from
-- the default privileges set in 20260910000000_multi_tenancy_rls.
ALTER TABLE "takedown_automation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_automation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_automation"
  USING ("organization_id" = current_setting('app.current_org_id', true));

ALTER TABLE "takedown_senders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_senders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_senders"
  USING ("organization_id" = current_setting('app.current_org_id', true));

ALTER TABLE "takedown_authorizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_authorizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_authorizations"
  USING ("organization_id" = current_setting('app.current_org_id', true));

ALTER TABLE "takedown_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_documents"
  USING ("organization_id" = current_setting('app.current_org_id', true));

ALTER TABLE "takedown_automation_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_automation_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_automation_events"
  USING ("organization_id" = current_setting('app.current_org_id', true));
