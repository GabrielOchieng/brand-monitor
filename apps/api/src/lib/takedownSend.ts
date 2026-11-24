import type { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";
import { decryptSecret } from "../auth/secretBox";
import { MailSendError, sendOrgMail, SenderSecretsSchema } from "./orgMailer";
import { automationBlockers, loadAutomationState, recordAutomationEvent, type AutomationBlocker } from "./takedownAutomation";
import { deliveryRecipients, loadRoutingData, recipientProblems } from "./recipients";
import { loadAttachments } from "./reportAttachments";
import { evaluatePolicy } from "./takedownPolicy";
import { hostnameOf } from "./reportContext";
import { notifyTakedown } from "./takedownNotify";

// Sends one takedown report (TAKEDOWN_AUTOMATION_PLAN.md §9-§10). Called by the dispatcher for
// due reports, and right away when an analyst approves one. Everything is checked again at send
// time; anything temporary (stop, caps, a pause) puts the report on hold instead of dropping it.

export const SENDABLE = ["queued", "pending_veto", "awaiting_approval"];

// Blockers that mean "not now" (hold) rather than "never".
const HOLD_BLOCKERS: AutomationBlocker[] = ["platform_disabled", "not_allowed", "no_sender", "sender_untested", "no_authorization", "not_enabled", "stopped", "monitoring_paused", "brand_off"];

export type SendOutcome = { status: "sent" | "held" | "skipped" | "failed" | "not_sendable"; detail?: string };

const CHANNEL_NAMES: Record<string, string> = { registrar: "registrar", host: "hosting provider", cert: "CERT" };

async function hold(orgId: string, id: string, reason: string, back: string): Promise<SendOutcome> {
  await withTenant(orgId, (tx) => tx.takedownAction.update({ where: { id }, data: { status: back, holdReason: reason } }));
  return { status: "held", detail: reason };
}

async function skip(orgId: string, id: string, reason: string): Promise<SendOutcome> {
  await withTenant(orgId, (tx) => tx.takedownAction.update({ where: { id }, data: { status: "skipped", skipReason: reason, holdReason: null } }));
  return { status: "skipped", detail: reason };
}

export async function sendAction(orgId: string, actionId: string, now = new Date()): Promise<SendOutcome> {
  // Claim it: only one sender ever moves a report into "sending".
  const before = await withTenant(orgId, (tx) => tx.takedownAction.findFirst({ where: { id: actionId, organizationId: orgId } }));
  if (!before || !SENDABLE.includes(before.status)) return { status: "not_sendable" };
  const claimed = await withTenant(orgId, (tx) => tx.takedownAction.updateMany({ where: { id: actionId, status: before.status }, data: { status: "sending" } }));
  if (claimed.count === 0) return { status: "not_sendable" };
  const back = before.status === "pending_veto" || before.status === "awaiting_approval" ? "queued" : before.status;

  try {
    const prep = await withTenant(orgId, async (tx) => {
      const action = await tx.takedownAction.findUniqueOrThrow({ where: { id: actionId } });
      const [state, automation, brand, finding, routing, sender] = await Promise.all([
        loadAutomationState(tx, orgId),
        tx.takedownAutomation.findUnique({ where: { organizationId: orgId } }),
        tx.brand.findUnique({ where: { id: action.brandId }, select: { id: true, autoTakedownEnabled: true, monitoringPausedAt: true } }),
        tx.finding.findUnique({
          where: { id: action.findingId },
          include: { websiteIntel: { select: { scannedAt: true, screenshotPath: true } } },
        }),
        loadRoutingData(tx, orgId),
        tx.takedownSender.findUnique({ where: { organizationId: orgId } }),
      ]);
      const ruleCodes = finding?.lastScanId
        ? (await tx.findingScoreEvent.findMany({ where: { scanId: finding.lastScanId, delta: { gt: 0 } }, select: { ruleCode: true } })).map((e) => e.ruleCode)
        : [];
      const since = new Date(now.getTime() - 24 * 3600_000);
      const sentToday = await tx.takedownAction.findMany({ where: { organizationId: orgId, status: "sent", redirected: false, sentAt: { gte: since } }, select: { to: true } });
      const attachments = await loadAttachments(tx, orgId, action);
      return { action, state, automation, brand, finding, ruleCodes, routing, sender, sentToday, attachments };
    });
    const { action, automation, brand, finding, sender } = prep;
    if (!brand || !finding || !automation) return await skip(orgId, actionId, "The finding or brand no longer exists.");

    // 1. Every switch (hold, not drop: they can come back on).
    const blockers = automationBlockers(prep.state, brand, now).filter((b) => HOLD_BLOCKERS.includes(b));
    if (blockers.length) return await hold(orgId, actionId, `Waiting: ${blockers.join(", ")}`, back);
    if (automation.stage === "shadow") return await hold(orgId, actionId, "Shadow mode: nothing is sent.", back);
    if (automation.stage === "redirect" && !automation.redirectTo) return await hold(orgId, actionId, "Redirect mode needs a redirect address.", back);

    // 2. Still worth sending? An analyst's approval overrides the policy, not the facts.
    if (finding.status === "false_positive" || finding.status === "resolved") return await skip(orgId, actionId, `The finding was marked ${finding.status.replace("_", " ")}.`);
    if (finding.downSince) return await skip(orgId, actionId, "The site is down.");
    if (action.createdAuto && !action.approvedBy) {
      const policy = evaluatePolicy(
        {
          type: finding.type,
          status: finding.status,
          severity: finding.severity,
          domain: hostnameOf(finding.identifier),
          liveStreak: finding.liveStreak,
          downSince: finding.downSince,
          ruleCodes: prep.ruleCodes,
          screenshotAt: finding.websiteIntel?.screenshotPath ? finding.websiteIntel.scannedAt : null,
        },
        automation,
        prep.routing.ownDomains,
        now
      );
      if (!policy.qualifies) return await skip(orgId, actionId, `No longer qualifies: ${policy.reason}`);
    }

    // 3. Recipients.
    if (action.to.length === 0) return await skip(orgId, actionId, "No recipient.");
    const problems = recipientProblems(action, prep.routing.ownDomains, prep.routing.blocked, now);
    if (problems.length) return await skip(orgId, actionId, `Recipient not allowed: ${problems.map((p) => p.address).join(", ")}`);

    // 4. Caps (live sends only; redirected test deliveries don't count).
    const redirectTo = automation.stage === "redirect" ? automation.redirectTo : null;
    if (!redirectTo) {
      if (prep.sentToday.length >= automation.dailyCap) return await hold(orgId, actionId, `Daily limit of ${automation.dailyCap} reports reached.`, back);
      for (const addr of action.to) {
        const n = prep.sentToday.filter((s) => s.to.includes(addr)).length;
        if (n >= automation.perRecipientCap) return await hold(orgId, actionId, `Daily limit of ${automation.perRecipientCap} reports to ${addr} reached.`, back);
      }
    }

    // 5. Send.
    if (!sender) return await hold(orgId, actionId, "No sender mailbox.", back);
    let secrets;
    try {
      secrets = SenderSecretsSchema.parse(JSON.parse(decryptSecret(sender.config)));
    } catch {
      return await hold(orgId, actionId, "The sender's credentials can't be read: enter them again.", back);
    }
    const delivery = deliveryRecipients(action, redirectTo);
    const text = delivery.redirected
      ? `REDIRECT MODE: this report was not sent to its recipients. It would have gone to:\nTo: ${action.to.join(", ")}${action.cc.length ? `\nCc: ${action.cc.join(", ")}` : ""}${action.bcc.length ? `\nBcc: ${action.bcc.join(", ")}` : ""}\n\n----------\n\n${action.body}`
      : action.body;
    let messageId: string | null = null;
    try {
      messageId = (
        await sendOrgMail(
          secrets,
          { fromAddress: sender.fromAddress, fromName: sender.fromName, replyTo: sender.replyTo, bccArchive: delivery.redirected ? null : sender.bccArchive },
          { to: delivery.to, cc: delivery.cc, bcc: delivery.bcc, subject: action.subject, text, attachments: prep.attachments }
        )
      ).messageId;
    } catch (err: any) {
      const cause = err?.cause?.code ?? err?.cause?.message;
      const error = (err instanceof MailSendError ? err.message : `Sending failed: ${String(err?.message ?? err)}${cause ? ` (${cause})` : ""}`).slice(0, 300);
      await withTenant(orgId, (tx) => tx.takedownAction.update({ where: { id: actionId }, data: { status: "failed", error, attempts: { increment: 1 }, holdReason: null } }));
      await notifyTakedown(orgId, action.findingId, `Takedown report ${action.reportRef} failed to send: ${error}`, { important: true });
      return { status: "failed", detail: error };
    }

    await withTenant(orgId, async (tx) => {
      let takedownId: string | null = null;
      if (!delivery.redirected) {
        const takedown = await tx.takedown.create({
          data: {
            findingId: action.findingId,
            provider: `${action.to[0]} (${CHANNEL_NAMES[action.channel] ?? action.channel})`,
            reference: action.reportRef,
            notes: action.approvedBy ? `Sent by Brand Monitor, approved by ${action.approvedBy}` : "Sent automatically by Brand Monitor",
            requestedById: "system",
          },
        });
        takedownId = takedown.id;
      }
      await tx.takedownAction.update({
        where: { id: actionId },
        data: { status: "sent", sentAt: new Date(), deliveredTo: delivery.to, redirected: delivery.redirected, messageId, takedownId, error: null, holdReason: null, attempts: { increment: 1 } },
      });
      await recordAutomationEvent(tx, orgId, { userId: null, email: action.approvedBy ?? "automatic" }, "report.sent", {
        actionId,
        findingId: action.findingId,
        channel: action.channel,
        to: delivery.to,
        redirected: delivery.redirected,
      });
    });
    await notifyTakedown(
      orgId,
      action.findingId,
      delivery.redirected ? `Takedown report ${action.reportRef} delivered to ${delivery.to[0]} (redirect mode)` : `Takedown report ${action.reportRef} sent to ${action.to.join(", ")}`
    );
    return { status: "sent" };
  } catch (err) {
    // Unexpected error: put it back so a later run can try, rather than leaving it stuck in "sending".
    await withTenant(orgId, (tx) => tx.takedownAction.updateMany({ where: { id: actionId, status: "sending" }, data: { status: back, holdReason: "Retrying after an error." } }));
    throw err;
  }
}

// A report stuck in "sending" for 15 minutes means the process died mid-send: it may or may not
// have gone out, so it's marked failed (an analyst checks the sent folder and retries) rather than
// re-queued, which could email a registrar twice.
export async function releaseStuck(tx: Prisma.TransactionClient, orgId: string, now = new Date()) {
  await tx.takedownAction.updateMany({
    where: { organizationId: orgId, status: "sending", updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
    data: { status: "failed", error: "Interrupted while sending. Check the sender mailbox's sent items before retrying." },
  });
}
