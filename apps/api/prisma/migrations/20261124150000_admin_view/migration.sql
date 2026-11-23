-- A platform admin's read-only view into an organization, held on their session.
ALTER TABLE "sessions" ADD COLUMN "admin_view_org_id" TEXT;
