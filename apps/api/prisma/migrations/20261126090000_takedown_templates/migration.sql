-- Automatic takedown reporting, step 2 (TAKEDOWN_AUTOMATION_PLAN.md): report templates with versions,
-- per-finding report drafts (takedown_actions), and the org's fixed report text.

-- AlterTable
ALTER TABLE "takedown_automation" ADD COLUMN     "company_details" TEXT,
ADD COLUMN     "disclaimer" TEXT;

-- CreateTable
CREATE TABLE "takedown_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "scope_key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "takedown_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takedown_template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_by" TEXT,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "takedown_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takedown_actions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "report_ref" TEXT NOT NULL,
    "to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "include_screenshot" BOOLEAN NOT NULL DEFAULT true,
    "document_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "template_source" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_test_at" TIMESTAMP(3),

    CONSTRAINT "takedown_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "takedown_templates_organization_id_scope_key_channel_kind_l_key" ON "takedown_templates"("organization_id", "scope_key", "channel", "kind", "language");

-- CreateIndex
CREATE INDEX "takedown_template_versions_template_id_status_idx" ON "takedown_template_versions"("template_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "takedown_template_versions_template_id_version_key" ON "takedown_template_versions"("template_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "takedown_actions_report_ref_key" ON "takedown_actions"("report_ref");

-- CreateIndex
CREATE INDEX "takedown_actions_finding_id_idx" ON "takedown_actions"("finding_id");

-- CreateIndex
CREATE INDEX "takedown_actions_organization_id_status_idx" ON "takedown_actions"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "takedown_template_versions" ADD CONSTRAINT "takedown_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "takedown_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RLS on organization_id, like the step 1 tables.
ALTER TABLE "takedown_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_templates"
  USING ("organization_id" = current_setting('app.current_org_id', true));

-- RLS on organization_id, like the step 1 tables.
ALTER TABLE "takedown_template_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_template_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_template_versions"
  USING ("organization_id" = current_setting('app.current_org_id', true));

-- RLS on organization_id, like the step 1 tables.
ALTER TABLE "takedown_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_actions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_actions"
  USING ("organization_id" = current_setting('app.current_org_id', true));

