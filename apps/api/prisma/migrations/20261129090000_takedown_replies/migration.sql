-- Automatic takedown reporting, step 5 (TAKEDOWN_AUTOMATION_PLAN.md §11): replies, bounces, follow-ups,
-- escalation.

-- AlterTable
ALTER TABLE "takedown_automation" ADD COLUMN     "escalate_days" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "follow_up_days" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "takedown_senders" ADD COLUMN     "read_replies" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replies_checked_at" TIMESTAMP(3),
ADD COLUMN     "replies_error" TEXT;

-- AlterTable
ALTER TABLE "takedown_actions" ADD COLUMN     "bounced_at" TIMESTAMP(3),
ADD COLUMN     "last_reply_at" TIMESTAMP(3),
ADD COLUMN     "previous_action_id" TEXT,
ADD COLUMN     "reply_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ticket_ref" TEXT;

-- CreateTable
CREATE TABLE "takedown_replies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "ticket_ref" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "takedown_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "takedown_replies_action_id_idx" ON "takedown_replies"("action_id");

-- CreateIndex
CREATE UNIQUE INDEX "takedown_replies_organization_id_provider_message_id_key" ON "takedown_replies"("organization_id", "provider_message_id");


-- RLS on organization_id, like the other takedown tables.
ALTER TABLE "takedown_replies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "takedown_replies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "takedown_replies"
  USING ("organization_id" = current_setting('app.current_org_id', true));
