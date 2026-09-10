-- AlterTable
ALTER TABLE "domain_intel" ADD COLUMN     "currently_resolves" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "first_resolved_at" TIMESTAMP(3);

-- Best-effort backfill for existing rows, since firstResolvedAt/currentlyResolves are new
-- and we have no scan-by-scan DNS history to derive them from exactly:
--   - currentlyResolves: inferred directly from whatever DNS data the row already has
--     (an ip, or a non-empty a/aaaa record list).
--   - firstResolvedAt: for a pipeline-discovered finding, discoveryJob.ts only ever
--     creates one after confirming a live DNS check at that exact moment (see
--     runDiscoveryJob's `if (!dns.exists) return;` gate) -- so first_detected_at IS a
--     genuine, correct "first confirmed resolving" timestamp for every such finding,
--     even one that has since gone fully non-resolving (the exact "lapsed" case this
--     migration exists to make visible). For a manually-submitted finding, no such
--     guarantee exists, so only backfill it when the row's current data proves it once
--     resolved -- otherwise leave it null ("never confirmed registered").
UPDATE "domain_intel" di
SET
  "currently_resolves" = (
    di."ip" IS NOT NULL
    OR jsonb_array_length(COALESCE(di."dns_records"->'a', '[]'::jsonb)) > 0
    OR jsonb_array_length(COALESCE(di."dns_records"->'aaaa', '[]'::jsonb)) > 0
  ),
  "first_resolved_at" = CASE
    WHEN f."source" = 'pipeline' THEN f."first_detected_at"
    WHEN di."ip" IS NOT NULL
      OR jsonb_array_length(COALESCE(di."dns_records"->'a', '[]'::jsonb)) > 0
      OR jsonb_array_length(COALESCE(di."dns_records"->'aaaa', '[]'::jsonb)) > 0
    THEN f."first_detected_at"
    ELSE NULL
  END
FROM "findings" f
WHERE f."id" = di."finding_id";
