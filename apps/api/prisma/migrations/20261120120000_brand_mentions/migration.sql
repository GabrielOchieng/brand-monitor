-- CreateTable
CREATE TABLE "brand_mentions" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT,
    "title" TEXT,
    "snippet" TEXT,
    "category" TEXT,
    "sentiment" TEXT,
    "label_attempts" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_mentions_brand_id_first_seen_at_idx" ON "brand_mentions"("brand_id", "first_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "brand_mentions_brand_id_url_key" ON "brand_mentions"("brand_id", "url");

-- AddForeignKey
ALTER TABLE "brand_mentions" ADD CONSTRAINT "brand_mentions_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS on brand_id, same shape as findings and public_reports. The app role's table grants
-- come from the default privileges set in 20260910000000_multi_tenancy_rls.
ALTER TABLE "brand_mentions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_mentions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "brand_mentions"
  USING ("brand_id" IN (
    SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
  ));
