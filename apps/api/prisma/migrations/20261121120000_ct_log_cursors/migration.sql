-- CreateTable
CREATE TABLE "ct_log_cursors" (
    "monitoring_url" TEXT NOT NULL,
    "next_tile" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ct_log_cursors_pkey" PRIMARY KEY ("monitoring_url")
);

-- Global (no tenant column) and only touched through adminPrisma, like provider_usage: no RLS.
