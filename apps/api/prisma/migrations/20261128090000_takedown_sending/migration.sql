-- Automatic takedown reporting, step 4 (TAKEDOWN_AUTOMATION_PLAN.md §5-§10): sending. Org policy, stage
-- (shadow / redirect / live) and caps, a mode per channel, the send lifecycle on takedown_actions,
-- and the finding's live streak.

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "last_reactivated_at" TIMESTAMP(3),
ADD COLUMN     "live_streak" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "takedown_automation" ADD COLUMN     "confirmed_skips_veto" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "daily_cap" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "min_severity" TEXT NOT NULL DEFAULT 'critical',
ADD COLUMN     "per_recipient_cap" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "shadow_days" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "shadow_started_at" TIMESTAMP(3),
ADD COLUMN     "signals" TEXT[] DEFAULT ARRAY['login_form', 'payment_form', 'shared_indicator', 'scam_pattern']::TEXT[],
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'shadow',
ADD COLUMN     "stage_changed_at" TIMESTAMP(3),
ADD COLUMN     "veto_hours" INTEGER NOT NULL DEFAULT 6;

-- AlterTable
ALTER TABLE "takedown_actions" ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancelled_by" TEXT,
ADD COLUMN     "created_auto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "delivered_to" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "error" TEXT,
ADD COLUMN     "hold_reason" TEXT,
ADD COLUMN     "message_id" TEXT,
ADD COLUMN     "qualified_by" JSONB,
ADD COLUMN     "redirected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "send_after" TIMESTAMP(3),
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "shadow_verdict" TEXT,
ADD COLUMN     "shadow_verdict_by" TEXT,
ADD COLUMN     "skip_reason" TEXT,
ADD COLUMN     "takedown_id" TEXT;

-- AlterTable
ALTER TABLE "takedown_channel_settings" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'off';


CREATE INDEX "takedown_actions_status_send_after_idx" ON "takedown_actions"("status", "send_after");

-- Alerts about takedown reports (lib/takedownNotify.ts), on for every existing org: in-app, and
-- email to owners/admins when a report fails. New orgs get it in auth/orgs.ts.
INSERT INTO "alert_rules" ("id", "organization_id", "kind", "config", "channels", "enabled")
SELECT 'default-takedown-activity-' || o."id", o."id", 'takedown_activity', '{}'::jsonb, ARRAY['in_app', 'email'], true
FROM "organizations" o
ON CONFLICT ("id") DO NOTHING;
