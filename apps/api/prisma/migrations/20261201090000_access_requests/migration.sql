-- Requests for access from new organizations (the public form at /request-access). Platform-wide,
-- not tenant data: read and handled only by platform admins in /admin, through adminPrisma.
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "brands" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "handled_by" TEXT,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "access_requests_status_check" CHECK ("status" IN ('new', 'handled', 'dismissed'))
);
CREATE INDEX "access_requests_created_at_idx" ON "access_requests"("created_at");

-- Default privileges from 20260910000000_multi_tenancy_rls granted it to the app role.
REVOKE ALL ON "access_requests" FROM brandmonitor_app;
