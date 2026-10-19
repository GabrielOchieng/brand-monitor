-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "report_token" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "report_id" TEXT,
ALTER COLUMN "finding_id" DROP NOT NULL,
ALTER COLUMN "scan_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "public_reports" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "url" TEXT,
    "phone" TEXT,
    "description" TEXT,
    "reporter_email" TEXT,
    "finding_id" TEXT,
    "matched_finding_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scan_queued" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "public_reports_brand_id_created_at_idx" ON "public_reports"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "public_reports_finding_id_idx" ON "public_reports"("finding_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_report_token_key" ON "brands"("report_token");



-- RLS on brand_id, same shape as findings. The public submit route finds the brand by
-- report_token through the admin client, then writes here inside withTenant.
ALTER TABLE "public_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "public_reports"
  USING ("brand_id" IN (
    SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
  ));

-- Default public_report alert rule (in-app only: the email template is finding-shaped,
-- and a report may have no finding). New orgs get it from the Clerk webhook.
INSERT INTO "alert_rules" ("id", "organization_id", "kind", "config", "channels", "enabled")
SELECT 'default-public-report-' || "id", "id", 'public_report', '{}'::jsonb, ARRAY['in_app'], true
FROM "organizations"
WHERE NOT EXISTS (
  SELECT 1 FROM "alert_rules" WHERE "alert_rules"."organization_id" = "organizations"."id" AND "alert_rules"."kind" = 'public_report'
);
