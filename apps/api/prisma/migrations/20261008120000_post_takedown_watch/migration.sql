-- AlterTable
ALTER TABLE "domain_intel" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "hosting_abuse_email" TEXT,
ADD COLUMN     "hosting_lookup_ip" TEXT,
ADD COLUMN     "hosting_org" TEXT,
ADD COLUMN     "last_changed_at" TIMESTAMP(3),
ADD COLUMN     "registrar_abuse_email" TEXT,
ADD COLUMN     "registrar_abuse_phone" TEXT,
ADD COLUMN     "status_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "down_since" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "website_intel" ADD COLUMN     "http_status" INTEGER;

-- CreateTable
CREATE TABLE "finding_changes" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finding_changes_finding_id_detected_at_idx" ON "finding_changes"("finding_id", "detected_at");

-- AddForeignKey
ALTER TABLE "finding_changes" ADD CONSTRAINT "finding_changes_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RLS: same join-through-findings shape as finding_notes/takedown_requests -- Prisma's diff
-- never adds this on its own.
ALTER TABLE "finding_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finding_changes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "finding_changes"
  USING ("finding_id" IN (
    SELECT "id" FROM "findings" WHERE "brand_id" IN (
      SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
    )
  ));

-- Default rules for the two new alert kinds, backfilled for existing orgs (new orgs get them
-- from the Clerk webhook, routes/webhooks.ts). Same per-kind NOT EXISTS shape as the
-- website_activated backfill.
INSERT INTO "alert_rules" ("id", "organization_id", "kind", "config", "channels", "enabled")
SELECT 'default-registration-changed-' || "id", "id", 'registration_changed', '{}'::jsonb, ARRAY['email', 'in_app'], true
FROM "organizations"
WHERE NOT EXISTS (
  SELECT 1 FROM "alert_rules" WHERE "alert_rules"."organization_id" = "organizations"."id" AND "alert_rules"."kind" = 'registration_changed'
);

INSERT INTO "alert_rules" ("id", "organization_id", "kind", "config", "channels", "enabled")
SELECT 'default-site-reactivated-' || "id", "id", 'site_reactivated', '{}'::jsonb, ARRAY['email', 'in_app'], true
FROM "organizations"
WHERE NOT EXISTS (
  SELECT 1 FROM "alert_rules" WHERE "alert_rules"."organization_id" = "organizations"."id" AND "alert_rules"."kind" = 'site_reactivated'
);
