-- Automatic takedown reporting, step 3 (TAKEDOWN_AUTOMATION_PLAN.md §3): recipients. Org and platform
-- contact books, fixed recipients per channel, never-send-to list, redirect mode, routing on drafts.

-- AlterTable
ALTER TABLE "takedown_automation" ADD COLUMN     "redirect_to" TEXT;

-- AlterTable
ALTER TABLE "takedown_actions" ADD COLUMN     "routing" JSONB;

-- CreateTable
CREATE TABLE "takedown_contacts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "match_type" TEXT NOT NULL,
    "match_value" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "form_url" TEXT,
    "instructions" TEXT,
    "language" TEXT,
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "takedown_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takedown_platform_contacts" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "match_type" TEXT NOT NULL,
    "match_value" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "form_url" TEXT,
    "instructions" TEXT,
    "language" TEXT,
    "note" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "takedown_platform_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takedown_channel_settings" (
    "organization_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "takedown_channel_settings_pkey" PRIMARY KEY ("organization_id","channel")
);

-- CreateTable
CREATE TABLE "takedown_blocked_recipients" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "takedown_blocked_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "takedown_contacts_organization_id_channel_idx" ON "takedown_contacts"("organization_id", "channel");

-- CreateIndex
CREATE INDEX "takedown_platform_contacts_channel_idx" ON "takedown_platform_contacts"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "takedown_blocked_recipients_organization_id_value_key" ON "takedown_blocked_recipients"("organization_id", "value");


-- RLS on organization_id, like the other takedown tables.
ALTER TABLE "takedown_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_contacts"
  USING ("organization_id" = current_setting('app.current_org_id', true));

ALTER TABLE "takedown_channel_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_channel_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_channel_settings"
  USING ("organization_id" = current_setting('app.current_org_id', true));

ALTER TABLE "takedown_blocked_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_blocked_recipients" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_blocked_recipients"
  USING ("organization_id" = current_setting('app.current_org_id', true));

-- The platform contact book is shared by every org: the app role may read it, only platform
-- admins (adminPrisma, routes/admin.ts) change it.
REVOKE ALL ON "takedown_platform_contacts" FROM brandmonitor_app;
GRANT SELECT ON "takedown_platform_contacts" TO brandmonitor_app;

-- Starting entries: providers known to take abuse reports by web form only (GoDaddy per its abuse
-- page, 2026-11; Cloudflare and Vercel as in the takedown kit), and the blocklist forms.
INSERT INTO "takedown_platform_contacts" ("id", "channel", "match_type", "match_value", "method", "form_url", "instructions", "updated_by", "updated_at") VALUES
  ('seed_registrar_godaddy', 'registrar', 'name', 'godaddy', 'form', 'https://www.godaddy.com/help/reporting-abuse-27154',
   'GoDaddy takes phishing reports through its abuse form, not by email. Give the full URL including the path; GoDaddy acts when the site is live and shows a login area.', 'seed', CURRENT_TIMESTAMP),
  ('seed_host_cloudflare', 'host', 'name', 'cloudflare', 'form', 'https://abuse.cloudflare.com/',
   'Choose the phishing form. Cloudflare usually sits in front of the real host and forwards the report to it; it also tells you who the real host is.', 'seed', CURRENT_TIMESTAMP),
  ('seed_host_vercel', 'host', 'name', 'vercel', 'form', 'https://vercel.com/abuse',
   'Choose phishing/fraud, paste the URL and the report text. Keep the case number Vercel returns.', 'seed', CURRENT_TIMESTAMP),
  ('seed_blocklist_safe_browsing', 'blocklist', 'any', '*', 'form', 'https://safebrowsing.google.com/safebrowsing/report_phish/',
   'Google Safe Browsing: once listed, Chrome, Android, Firefox and Safari warn visitors. Paste the report text into the details box.', 'seed', CURRENT_TIMESTAMP),
  ('seed_blocklist_netcraft', 'blocklist', 'any', '*', 'form', 'https://report.netcraft.com/',
   'Netcraft: passes confirmed phishing to browser blocklists and often to the host. Paste the URL and the report text.', 'seed', CURRENT_TIMESTAMP);
