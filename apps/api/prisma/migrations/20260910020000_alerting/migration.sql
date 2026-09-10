-- Stage C: alerting (rules, delivery audit trail, in-app notifications, webhook config).

-- 1. New tables ---------------------------------------------------------------

CREATE TABLE "alert_rules" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "channels" TEXT[] NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "alert_deliveries" (
  "id" TEXT NOT NULL,
  "alert_rule_id" TEXT NOT NULL,
  "finding_id" TEXT NOT NULL,
  "scan_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "alert_deliveries_alert_rule_id_finding_id_scan_id_channel_key"
  ON "alert_deliveries"("alert_rule_id", "finding_id", "scan_id", "channel");
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_alert_rule_id_fkey"
  FOREIGN KEY ("alert_rule_id") REFERENCES "alert_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "finding_id" TEXT NOT NULL,
  "scan_id" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_configs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "webhook_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_configs_organization_id_key" ON "webhook_configs"("organization_id");

-- 2. Row-level security ---------------------------------------------------------

ALTER TABLE "alert_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alert_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "alert_rules"
  USING ("organization_id" = current_setting('app.current_org_id', true));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "notifications"
  USING ("organization_id" = current_setting('app.current_org_id', true));

ALTER TABLE "webhook_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_configs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "webhook_configs"
  USING ("organization_id" = current_setting('app.current_org_id', true));

-- Reachable only via alert_rule_id -> alert_rules.organization_id.
ALTER TABLE "alert_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alert_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "alert_deliveries"
  USING ("alert_rule_id" IN (
    SELECT "id" FROM "alert_rules" WHERE "organization_id" = current_setting('app.current_org_id', true)
  ));

-- 3. Backfill a default rule for every organization that already exists ---------
-- The Clerk webhook's organization.created handler seeds this for new orgs going
-- forward; without this, every org created before this migration (all of Stage A/B
-- testing) would silently have no alerting at all.
INSERT INTO "alert_rules" ("id", "organization_id", "kind", "config", "channels", "enabled")
SELECT
  'default-severity-high-' || "id",
  "id",
  'severity_threshold',
  '{"minSeverity": "high"}'::jsonb,
  ARRAY['email', 'in_app'],
  true
FROM "organizations"
WHERE NOT EXISTS (
  SELECT 1 FROM "alert_rules" WHERE "alert_rules"."organization_id" = "organizations"."id"
);
