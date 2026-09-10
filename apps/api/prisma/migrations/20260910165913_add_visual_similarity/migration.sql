-- AlterTable
ALTER TABLE "website_intel" ADD COLUMN     "screenshot_hash" TEXT,
ADD COLUMN     "visual_similarity_match" BOOLEAN NOT NULL DEFAULT false;
