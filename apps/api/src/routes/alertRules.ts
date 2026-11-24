import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";

// Alert rules as the Settings page edits them: one rule per kind per organization, each
// switched on or off, sent to some channels, with a threshold where the kind has one.
// queue/alertDispatch.ts (ruleMatches) and routes/publicReports.ts read the same rows.
// Orgs get five of these seeded on creation (routes/webhooks.ts); the other two kinds
// (new_finding, score_increase) are created here the first time someone turns them on.

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export const ALERT_KINDS = {
  severity_threshold: { channels: ["email", "in_app", "webhook"], defaults: { minSeverity: "high" } },
  new_finding: { channels: ["email", "in_app", "webhook"], defaults: { minSeverity: "medium" } },
  score_increase: { channels: ["email", "in_app", "webhook"], defaults: { minDelta: 20 } },
  website_activated: { channels: ["email", "in_app", "webhook"], defaults: {} },
  site_reactivated: { channels: ["email", "in_app", "webhook"], defaults: {} },
  registration_changed: { channels: ["email", "in_app", "webhook"], defaults: {} },
  // In-app only: the email template is finding-shaped (routes/publicReports.ts).
  public_report: { channels: ["in_app"], defaults: {} },
  // Automatic takedown reports: queued for veto, waiting for approval, sent, failed, replies.
  // Email only for the important ones (a failure), to owners and admins (lib/takedownNotify.ts).
  takedown_activity: { channels: ["in_app", "email"], defaults: {} },
} as const satisfies Record<string, { channels: readonly string[]; defaults: Record<string, unknown> }>;

export type AlertKind = keyof typeof ALERT_KINDS;

const UpdateSchema = z.object({
  enabled: z.boolean(),
  channels: z.array(z.enum(["email", "in_app", "webhook"])).max(3),
  config: z
    .object({
      minSeverity: z.enum(SEVERITIES).optional(),
      minDelta: z.number().int().min(5).max(100).optional(),
    })
    .default({}),
});

// Keeps only what the kind supports: its own channels and its own threshold field.
export function normalizeRuleUpdate(kind: AlertKind, input: z.infer<typeof UpdateSchema>) {
  const spec = ALERT_KINDS[kind];
  const channels = [...new Set(input.channels)].filter((c) => (spec.channels as readonly string[]).includes(c));
  const config: Record<string, string | number> = { ...spec.defaults };
  if ("minSeverity" in spec.defaults && input.config.minSeverity) config.minSeverity = input.config.minSeverity;
  if ("minDelta" in spec.defaults && input.config.minDelta !== undefined) config.minDelta = input.config.minDelta;
  return { enabled: input.enabled, channels, config };
}

export async function alertRuleRoutes(app: FastifyInstance) {
  // Every kind, whether or not the org has a row for it yet (missing = off, defaults).
  app.get("/api/alert-rules", { preHandler: authenticate }, async (request, reply) => {
    const orgId = request.auth!.orgId;
    const rows = await withTenant(orgId, (tx) => tx.alertRule.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } }));
    const rules = (Object.keys(ALERT_KINDS) as AlertKind[]).map((kind) => {
      const row = rows.find((r) => r.kind === kind);
      const spec = ALERT_KINDS[kind];
      return {
        kind,
        enabled: row?.enabled ?? false,
        channels: row?.channels ?? [],
        config: { ...spec.defaults, ...((row?.config as Record<string, unknown> | null) ?? {}) },
        allowedChannels: spec.channels,
        exists: Boolean(row),
      };
    });
    return reply.send({ rules });
  });

  app.put(
    "/api/alert-rules/:kind",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const { kind } = request.params as { kind: string };
      if (!(kind in ALERT_KINDS)) return reply.status(404).send({ error: "not_found" });
      const parsed = UpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const orgId = request.auth!.orgId;
      const update = normalizeRuleUpdate(kind as AlertKind, parsed.data);

      const rule = await withTenant(orgId, async (tx) => {
        // Older orgs may hold more than one row of a kind; all of them follow the setting so
        // a stray duplicate can't keep alerting after it's switched off.
        const existing = await tx.alertRule.findMany({ where: { organizationId: orgId, kind } });
        if (existing.length > 0) {
          await tx.alertRule.updateMany({ where: { organizationId: orgId, kind }, data: update });
          return tx.alertRule.findUniqueOrThrow({ where: { id: existing[0].id } });
        }
        return tx.alertRule.create({ data: { organizationId: orgId, kind, ...update } });
      });
      return reply.send({ kind, enabled: rule.enabled, channels: rule.channels, config: rule.config });
    }
  );
}
