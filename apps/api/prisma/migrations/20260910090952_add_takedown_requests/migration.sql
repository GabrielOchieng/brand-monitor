-- CreateTable
CREATE TABLE "takedown_requests" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "notes" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "takedown_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "takedown_requests" ADD CONSTRAINT "takedown_requests_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: same join-through-findings shape as finding_notes/ai_explanations -- Prisma's diff
-- never adds this on its own, and every table added since Stage A has needed one.
ALTER TABLE "takedown_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_requests"
  USING ("finding_id" IN (
    SELECT "id" FROM "findings" WHERE "brand_id" IN (
      SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
    )
  ));
