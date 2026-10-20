-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "down_streak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "first_live_at" TIMESTAMP(3);

-- Backfill first_live_at so findings that are already live, or already fired website_activated,
-- don't alert again on their next live scan after deploy.
UPDATE "findings" f SET "first_live_at" = w."scanned_at"
FROM "website_intel" w
WHERE w."finding_id" = f."id"
  AND NOT w."looks_parked"
  AND (w."http_status" IS NULL OR w."http_status" NOT IN (404, 410, 451));

UPDATE "findings" f SET "first_live_at" = d."first_fired"
FROM (
  SELECT d."finding_id", min(d."created_at") AS "first_fired"
  FROM "alert_deliveries" d JOIN "alert_rules" r ON r."id" = d."alert_rule_id"
  WHERE r."kind" = 'website_activated'
  GROUP BY d."finding_id"
) d
WHERE d."finding_id" = f."id"
  AND (f."first_live_at" IS NULL OR d."first_fired" < f."first_live_at");
