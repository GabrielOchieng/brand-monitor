-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "assignee_id" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "finding_notes" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_notes_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_notes" ADD CONSTRAINT "finding_notes_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: same join-through-findings shape as "scans" (see the Stage B migration) -- Prisma's
-- diff never adds this on its own, and every table added since Stage A has needed one.
ALTER TABLE "finding_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finding_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "finding_notes"
  USING ("finding_id" IN (
    SELECT "id" FROM "findings" WHERE "brand_id" IN (
      SELECT "id" FROM "brands" WHERE "organization_id" = current_setting('app.current_org_id', true)
    )
  ));
