-- CreateTable
CREATE TABLE "finding_indicators" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finding_indicators_brand_id_kind_value_idx" ON "finding_indicators"("brand_id", "kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "finding_indicators_finding_id_kind_value_key" ON "finding_indicators"("finding_id", "kind", "value");

-- AddForeignKey
ALTER TABLE "finding_indicators" ADD CONSTRAINT "finding_indicators_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- RLS: keyed on the denormalized brand_id (same shape as findings' own policy), so the
-- "other findings with this number" lookup needs no join. Prisma's diff never adds this.
ALTER TABLE "finding_indicators" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finding_indicators" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "finding_indicators"
  USING ("brand_id" IN (
    SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
  ));
