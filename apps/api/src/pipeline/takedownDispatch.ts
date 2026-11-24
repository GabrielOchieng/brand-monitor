import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { adminPrisma } from "../adminDb";
import { env } from "../env";
import { withTenant } from "../lib/tenant";
import { listMonitoredBrands } from "../lib/monitoredBrands";
import { automationBlockers, loadAutomationState } from "../lib/takedownAutomation";
import { evaluatePolicy, initialStatus, sendAfterFor } from "../lib/takedownPolicy";
import { channelsFor, hostnameOf, loadReportContext, resolveTemplate } from "../lib/reportContext";
import { newReportRef, renderTemplate, type Channel } from "../lib/reportTemplates";
import { loadRoutingData, resolveRouting } from "../lib/recipients";
import { releaseStuck, sendAction } from "../lib/takedownSend";
import { notifyTakedown } from "../lib/takedownNotify";

// The takedown dispatcher (every 5 min, queue takedown-dispatch; TAKEDOWN_AUTOMATION_PLAN.md §9).
// Per org with automatic reporting on: prepares first reports for qualifying website findings on
// every channel whose mode isn't "off", then sends the reports that are due. Does nothing at all
// unless AUTO_TAKEDOWN_ENABLED=1.

const MAX_NEW_PER_RUN = 50;
const MAX_SENDS_PER_RUN = 30;

export async function runTakedownDispatch(now = new Date()): Promise<{ created: number; sent: number }> {
  if (!env.autoTakedownEnabled) return { created: 0, sent: 0 };
  // Cross-tenant, id-only: orgs whose owner turned it on.
  const orgs = await adminPrisma.takedownAutomation.findMany({ where: { enabledAt: { not: null } }, select: { organizationId: true } });
  const brands = await listMonitoredBrands();
  let created = 0;
  let sent = 0;
  for (const { organizationId } of orgs) {
    const orgBrands = brands.filter((b) => b.organizationId === organizationId).map((b) => b.id);
    try {
      created += await prepareReports(organizationId, orgBrands, now);
      sent += await sendDue(organizationId, now);
    } catch (err) {
      console.error(`takedown dispatch failed for org ${organizationId}`, err);
    }
  }
  return { created, sent };
}

async function prepareReports(orgId: string, brandIds: string[], now: Date): Promise<number> {
  if (brandIds.length === 0) return 0;
  const notices: Array<{ findingId: string; message: string }> = [];
  const created = await withTenant(orgId, async (tx) => {
    const state = await loadAutomationState(tx, orgId);
    // Org-level switches. Shadow mode still records what would be sent, so it only needs the setup.
    const orgBlockers = automationBlockers(state, null, now);
    if (orgBlockers.length) return 0;
    const [automation, settings, brands, routingData] = await Promise.all([
      tx.takedownAutomation.findUniqueOrThrow({ where: { organizationId: orgId } }),
      tx.takedownChannelSetting.findMany({ where: { organizationId: orgId } }),
      tx.brand.findMany({ where: { id: { in: brandIds }, autoTakedownEnabled: true }, select: { id: true } }),
      loadRoutingData(tx, orgId),
    ]);
    await releaseStuck(tx, orgId, now);
    const modes = new Map(settings.map((s) => [s.channel, s.mode]));
    if (![...modes.values()].some((m) => m !== "off")) return 0;

    const candidates = await tx.finding.findMany({
      where: { brandId: { in: brands.map((b) => b.id) }, type: { in: ["domain", "url"] }, status: { in: ["new", "investigating", "confirmed"] }, liveStreak: { gte: 2 }, downSince: null },
      include: { websiteIntel: { select: { scannedAt: true, screenshotPath: true } } },
      orderBy: { riskScore: "desc" },
      take: 500,
    });
    let n = 0;
    for (const f of candidates) {
      if (n >= MAX_NEW_PER_RUN) break;
      const ruleCodes = f.lastScanId ? (await tx.findingScoreEvent.findMany({ where: { scanId: f.lastScanId, delta: { gt: 0 } }, select: { ruleCode: true } })).map((e) => e.ruleCode) : [];
      const policy = evaluatePolicy(
        {
          type: f.type,
          status: f.status,
          severity: f.severity,
          domain: hostnameOf(f.identifier),
          liveStreak: f.liveStreak,
          downSince: f.downSince,
          ruleCodes,
          screenshotAt: f.websiteIntel?.screenshotPath ? f.websiteIntel.scannedAt : null,
        },
        automation,
        routingData.ownDomains,
        now
      );
      if (!policy.qualifies) continue;

      for (const channel of channelsFor(f.type) as Channel[]) {
        const mode = modes.get(channel) ?? "off";
        if (mode === "off") continue;
        // Already reported on this channel (in any state, a cancel included) since the site last came back?
        const existing = await tx.takedownAction.count({
          where: { findingId: f.id, channel, kind: "first", ...(f.lastReactivatedAt ? { createdAt: { gt: f.lastReactivatedAt } } : {}) },
        });
        if (existing > 0) continue;
        n += await createAutoReport(tx, orgId, f.id, channel, mode, automation, policy, routingData, now, notices);
      }
    }
    return n;
  });
  for (const x of notices) await notifyTakedown(orgId, x.findingId, x.message);
  return created;
}

async function createAutoReport(
  tx: Prisma.TransactionClient,
  orgId: string,
  findingId: string,
  channel: Channel,
  mode: string,
  automation: { stage: string; vetoHours: number; confirmedSkipsVeto: boolean },
  policy: Extract<ReturnType<typeof evaluatePolicy>, { qualifies: true }>,
  routingData: Awaited<ReturnType<typeof loadRoutingData>>,
  now: Date,
  notices: Array<{ findingId: string; message: string }>
): Promise<number> {
  let reportRef = newReportRef(randomBytes);
  while (await tx.takedownAction.findUnique({ where: { reportRef }, select: { id: true } })) reportRef = newReportRef(randomBytes);
  const loaded = await loadReportContext(tx, orgId, findingId, { reportRef, apiOrigin: env.apiPublicUrl });
  if (!loaded) return 0;
  const routing = resolveRouting(channel, loaded.finding.facts, routingData.rules, routingData.fixed.get(channel) ?? null, routingData.ownDomains, routingData.blocked, now);
  if (routing.method === "skip") return 0;
  const language = routing.language ?? "en";
  const template = await resolveTemplate(tx, orgId, loaded.finding.brandId, channel, "first", language);
  const rendered = renderTemplate(template, loaded.context);
  const status = initialStatus(automation.stage, mode, routing.method);
  const sendAfter = status === "pending_veto" || status === "queued" ? sendAfterFor(mode, policy.via === "confirmed", automation, now) : null;
  await tx.takedownAction.create({
    data: {
      organizationId: orgId,
      brandId: loaded.finding.brandId,
      findingId,
      channel,
      kind: "first",
      language,
      status,
      reportRef,
      to: routing.to,
      cc: routing.cc,
      bcc: routing.bcc,
      subject: rendered.subject,
      body: rendered.body,
      includeScreenshot: !!loaded.finding.screenshotFile,
      templateSource: template.source,
      routing: routing as object,
      createdAuto: true,
      qualifiedBy: policy as object,
      sendAfter,
      createdBy: "automatic",
      updatedBy: "automatic",
    },
  });
  const target = loaded.finding.identifier;
  if (status === "pending_veto") notices.push({ findingId, message: `Takedown report to the ${channel} for ${target} goes out ${sendAfter && sendAfter > now ? `at ${sendAfter.toISOString().slice(11, 16)} UTC` : "shortly"} unless cancelled` });
  else if (status === "awaiting_approval") notices.push({ findingId, message: `Takedown report to the ${channel} for ${target} is waiting for approval` });
  else if (status === "manual") notices.push({ findingId, message: `Takedown report to the ${channel} for ${target} needs to be sent by hand (web form or no address)` });
  return 1;
}

async function sendDue(orgId: string, now: Date): Promise<number> {
  const due = await withTenant(orgId, (tx) =>
    tx.takedownAction.findMany({
      where: { organizationId: orgId, OR: [{ status: "queued" }, { status: "pending_veto", sendAfter: { lte: now } }] },
      orderBy: { createdAt: "asc" },
      take: MAX_SENDS_PER_RUN,
      select: { id: true },
    })
  );
  let sent = 0;
  for (const { id } of due) {
    const r = await sendAction(orgId, id, now);
    if (r.status === "sent") sent++;
    // A cap or a stop applies to the rest of this org's queue too.
    // (A per-recipient limit only holds that report.)
    if (r.status === "held" && /^(Waiting|Shadow|Redirect|No sender|The sender)|^Daily limit of d+ reports reached/.test(r.detail ?? "")) break;
  }
  return sent;
}
