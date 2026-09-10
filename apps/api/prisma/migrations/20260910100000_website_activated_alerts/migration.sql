-- Data-only migration: AlertRule.kind is a free-text column (no DDL change needed) --
-- this backfills a default "website_activated" rule for every organization that
-- already exists, same as the original alerting migration backfilled
-- "severity_threshold". The Clerk webhook's organization.created handler seeds this
-- for new orgs going forward (see routes/webhooks.ts).
--
-- Scoped by kind, not just "org has any alert_rules row" -- every existing org already
-- has a severity_threshold row from the original alerting migration's backfill, so a
-- naive copy of that migration's WHERE NOT EXISTS clause would match zero orgs here.
INSERT INTO "alert_rules" ("id", "organization_id", "kind", "config", "channels", "enabled")
SELECT
  'default-website-activated-' || "id",
  "id",
  'website_activated',
  '{}'::jsonb,
  ARRAY['email', 'in_app'],
  true
FROM "organizations"
WHERE NOT EXISTS (
  SELECT 1 FROM "alert_rules" WHERE "alert_rules"."organization_id" = "organizations"."id" AND "alert_rules"."kind" = 'website_activated'
);
