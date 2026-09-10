-- Stage B: scan batching for append-only score history, plus recheck scheduling.

-- 1. New Scan table ------------------------------------------------------------

CREATE TABLE "scans" (
  "id" TEXT NOT NULL,
  "finding_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "triggered_by" TEXT NOT NULL,
  "score" INTEGER,
  "severity" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "scans" ADD CONSTRAINT "scans_finding_id_fkey"
  FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Findings: recheck scheduling + pointer to current scan --------------------

ALTER TABLE "findings" ADD COLUMN "next_scan_at" TIMESTAMP(3);
ALTER TABLE "findings" ADD COLUMN "last_scan_id" TEXT;
-- Existing findings (pre-dating this migration) get picked up by the recheck dispatcher
-- on its very next tick, which both schedules them going forward and produces their
-- first real Scan row (see point 3 below for why their old score events don't survive).
UPDATE "findings" SET "next_scan_at" = CURRENT_TIMESTAMP;

-- 3. FindingScoreEvent/FindingEvidence: tag with the scan that produced them ---
-- Pre-Stage-B rows have no scan to belong to (they predate the concept, and the old
-- pipeline deleted-and-recreated them on every run anyway, so nothing here is data
-- worth preserving) -- clearing them is simpler and more honest than fabricating
-- placeholder Scan rows for history that was never really batched in the first place.
-- This is disposable pre-launch dev/demo data; the next recheck regenerates it properly.
DELETE FROM "finding_evidence";
DELETE FROM "finding_score_events";

ALTER TABLE "finding_evidence" ADD COLUMN "scan_id" TEXT NOT NULL;
ALTER TABLE "finding_evidence" ADD CONSTRAINT "finding_evidence_scan_id_fkey"
  FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finding_score_events" ADD COLUMN "scan_id" TEXT NOT NULL;
ALTER TABLE "finding_score_events" ADD CONSTRAINT "finding_score_events_scan_id_fkey"
  FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. RLS on the new table -------------------------------------------------------
-- Same subquery shape as domain_intel/website_intel (Stage A migration): reachable only
-- via finding_id -> findings.brand_id -> brands.organization_id.

ALTER TABLE "scans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scans" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "scans"
  USING ("finding_id" IN (
    SELECT "id" FROM "findings" WHERE "brand_id" IN (
      SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
    )
  ));
