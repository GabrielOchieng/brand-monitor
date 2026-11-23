-- Platform admins can pause monitoring for a whole organization or one brand. Data is kept;
-- the scheduled jobs and manual triggers skip paused brands (src/lib/monitoredBrands.ts).
ALTER TABLE "organizations" ADD COLUMN "monitoring_paused_at" TIMESTAMP(3), ADD COLUMN "monitoring_paused_by" TEXT;
ALTER TABLE "brands" ADD COLUMN "monitoring_paused_at" TIMESTAMP(3), ADD COLUMN "monitoring_paused_by" TEXT;
