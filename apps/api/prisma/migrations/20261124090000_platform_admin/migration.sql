-- Platform admins (above every organization) and their audit log.
ALTER TABLE "users" ADD COLUMN "platform_role" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_platform_role_check" CHECK ("platform_role" IN ('admin', 'superadmin'));

CREATE TABLE "admin_audit_log" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "admin_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at");

-- Default privileges from 20260910000000_multi_tenancy_rls granted it to the app role.
REVOKE ALL ON "admin_audit_log" FROM brandmonitor_app;
