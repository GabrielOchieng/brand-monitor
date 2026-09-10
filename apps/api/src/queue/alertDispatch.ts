import { withTenant } from "../lib/tenant";
import { sendAlertEmail } from "../lib/email";
import { sendWebhook } from "../lib/webhookDelivery";
import { boss, QUEUE_ALERT_DISPATCH } from "./boss";

const SEVERITY_RANK = ["low", "medium", "high", "critical"];
function rank(severity: string): number {
  const idx = SEVERITY_RANK.indexOf(severity);
  return idx === -1 ? 0 : idx;
}

export interface AlertDispatchJobData {
  findingId: string;
  scanId: string;
  organizationId: string;
  previousScore: number;
  previousSeverity: string;
  newScore: number;
  newSeverity: string;
  isFirstScan: boolean;
  // True when this scan found real, non-parked website content where the previous
  // scan (or the total absence of one) did not -- see recheckJob.ts. Raw fact, not
  // pre-filtered for isFirstScan; ruleMatches applies that guard itself, same as
  // score_increase does.
  justActivated: boolean;
}

interface RuleLike {
  id: string;
  kind: string;
  config: any;
  channels: string[];
}

// Deliberately conservative defaults so a finding sitting steadily at one severity, or a
// low/parked first-scan result, doesn't re-alert every 5 minutes forever.
function ruleMatches(rule: RuleLike, data: AlertDispatchJobData): boolean {
  switch (rule.kind) {
    case "severity_threshold": {
      const minRank = rank(rule.config?.minSeverity ?? "high");
      const crossedUp = data.isFirstScan || rank(data.previousSeverity) < rank(data.newSeverity);
      return rank(data.newSeverity) >= minRank && crossedUp;
    }
    case "score_increase": {
      if (data.isFirstScan) return false; // no real delta yet
      const minDelta = Number(rule.config?.minDelta ?? 20);
      return data.newScore - data.previousScore >= minDelta;
    }
    case "new_finding": {
      if (!data.isFirstScan) return false;
      const minRank = rank(rule.config?.minSeverity ?? "medium");
      return rank(data.newSeverity) >= minRank;
    }
    case "website_activated": {
      // Excludes isFirstScan: a domain that's live from day one isn't a "dormant ->
      // active" transition, it's just the first observation -- that's new_finding's
      // job. Without this guard, a live-from-day-one finding would fire both rules for
      // the same event (two separate alerts for one fact).
      if (data.isFirstScan) return false;
      return data.justActivated;
    }
    default:
      return false;
  }
}

async function deliverChannel(
  channel: string,
  rule: RuleLike,
  data: AlertDispatchJobData,
  finding: { identifier: string },
  webhookConfig: { url: string; secret: string } | null
): Promise<void> {
  const { organizationId } = data;
  const deliveryKey = { alertRuleId_findingId_scanId_channel: { alertRuleId: rule.id, findingId: data.findingId, scanId: data.scanId, channel } };

  // Dedup: claim this exact delivery slot first. A unique-constraint violation means a
  // delivery attempt already exists for this rule+finding+scan+channel -- skip only if
  // it already succeeded; a stuck "pending" (crashed mid-send) or "failed" row is
  // retried, not treated as done.
  //
  // The failed create and the fallback lookup MUST be separate withTenant calls (separate
  // transactions) -- Postgres aborts an entire transaction after any failed statement, so
  // a second query inside the SAME transaction as the caught unique-violation fails too
  // (25P02 "current transaction is aborted"), even though the JS catch block itself
  // looks fine. Confirmed by hitting this directly rather than assuming try/catch was
  // sufficient.
  let created = false;
  try {
    await withTenant(organizationId, (tx) =>
      tx.alertDelivery.create({ data: { alertRuleId: rule.id, findingId: data.findingId, scanId: data.scanId, channel, status: "pending" } })
    );
    created = true;
  } catch (err: any) {
    if (err?.code !== "P2002") throw err;
  }
  if (!created) {
    const existing = await withTenant(organizationId, (tx) => tx.alertDelivery.findUnique({ where: deliveryKey }));
    if (existing?.status === "sent") return;
  }

  try {
    if (channel === "email") {
      const members = await withTenant(organizationId, (tx) => tx.membership.findMany({ where: { organizationId }, include: { user: true } }));
      const recipients = members.map((m) => m.user.email).filter(Boolean);
      if (recipients.length > 0) {
        await sendAlertEmail({
          to: recipients.join(","),
          findingIdentifier: finding.identifier,
          findingId: data.findingId,
          previousScore: data.previousScore,
          previousSeverity: data.previousSeverity,
          newScore: data.newScore,
          newSeverity: data.newSeverity,
        });
      }
    } else if (channel === "in_app") {
      await withTenant(organizationId, (tx) =>
        tx.notification.create({
          data: {
            organizationId,
            findingId: data.findingId,
            scanId: data.scanId,
            message: `${finding.identifier} is now ${data.newSeverity} (${data.newScore}/100)`,
          },
        })
      );
    } else if (channel === "webhook" && webhookConfig) {
      await sendWebhook(webhookConfig.url, webhookConfig.secret, {
        event: "finding.score_changed",
        finding: { id: data.findingId, identifier: finding.identifier },
        previousScore: data.previousScore,
        previousSeverity: data.previousSeverity,
        newScore: data.newScore,
        newSeverity: data.newSeverity,
      });
    }

    await withTenant(organizationId, (tx) => tx.alertDelivery.update({ where: deliveryKey, data: { status: "sent" } }));
  } catch (err: any) {
    await withTenant(organizationId, (tx) =>
      tx.alertDelivery.update({ where: deliveryKey, data: { status: "failed", error: String(err?.message ?? err) } })
    );
  }
}

export async function runAlertDispatchJob(data: AlertDispatchJobData): Promise<void> {
  const { organizationId } = data;

  const finding = await withTenant(organizationId, (tx) => tx.finding.findUniqueOrThrow({ where: { id: data.findingId } }));
  const rules = await withTenant(organizationId, (tx) => tx.alertRule.findMany({ where: { organizationId, enabled: true } }));
  const webhookConfig = await withTenant(organizationId, (tx) => tx.webhookConfig.findUnique({ where: { organizationId } }));
  const activeWebhookConfig = webhookConfig?.enabled ? webhookConfig : null;

  for (const rule of rules as RuleLike[]) {
    if (!ruleMatches(rule, data)) continue;
    for (const channel of rule.channels) {
      if (channel === "webhook" && !activeWebhookConfig) continue; // nothing to deliver to
      await deliverChannel(channel, rule, data, finding, activeWebhookConfig);
    }
  }
}

export async function registerAlertDispatchWorker(): Promise<void> {
  await boss.work<AlertDispatchJobData>(QUEUE_ALERT_DISPATCH, { localConcurrency: 5 }, async ([job]) => {
    await runAlertDispatchJob(job.data);
  });
}
