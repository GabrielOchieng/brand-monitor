-- AlterTable
ALTER TABLE "brands" ADD COLUMN "official_social_urls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "link" TEXT;

-- CreateTable
CREATE TABLE "social_intel" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT,
    "post_url" TEXT,
    "title" TEXT,
    "snippet" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_intel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_usage" (
    "provider" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "provider_usage_pkey" PRIMARY KEY ("provider","period")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_intel_finding_id_key" ON "social_intel"("finding_id");

-- AddForeignKey
ALTER TABLE "social_intel" ADD CONSTRAINT "social_intel_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- RLS: same denormalized brand_id shape as finding_indicators. provider_usage is global
-- (no tenant column) and only touched through adminPrisma, so it gets none.
ALTER TABLE "social_intel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_intel" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "social_intel"
  USING ("brand_id" IN (
    SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
  ));
