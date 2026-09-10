-- CreateTable
CREATE TABLE "ai_explanations" (
    "id" TEXT NOT NULL,
    "scan_id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_explanations_scan_id_key" ON "ai_explanations"("scan_id");

-- AddForeignKey
ALTER TABLE "ai_explanations" ADD CONSTRAINT "ai_explanations_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_explanations" ADD CONSTRAINT "ai_explanations_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: same join-through-findings shape as "scans"/"finding_notes" -- Prisma's diff never
-- adds this on its own, and every table added since Stage A has needed one.
ALTER TABLE "ai_explanations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_explanations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ai_explanations"
  USING ("finding_id" IN (
    SELECT "id" FROM "findings" WHERE "brand_id" IN (
      SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
    )
  ));
