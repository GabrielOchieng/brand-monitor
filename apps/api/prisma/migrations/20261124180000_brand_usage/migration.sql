-- Per-brand monthly usage of metered providers (Tavily), for the admin panel.
CREATE TABLE "brand_usage" (
    "brand_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "brand_usage_pkey" PRIMARY KEY ("brand_id","period","provider")
);

-- Only the jobs and admin routes touch it, through the migration role (adminPrisma).
REVOKE ALL ON "brand_usage" FROM brandmonitor_app;
