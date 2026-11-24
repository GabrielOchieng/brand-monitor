import { withTenant } from "../lib/tenant";
import { decryptSecret } from "../auth/secretBox";
import { canReadMailbox, readInbox, SenderSecretsSchema } from "../lib/orgMailer";
import { bouncedRecipients, isBounce, isOutOfOffice, reportRefsIn, ticketRefIn } from "../lib/replyParsing";
import { automationBlockers, loadAutomationState, recordAutomationEvent } from "../lib/takedownAutomation";
import { loadRoutingData } from "../lib/recipients";
import { notifyTakedown } from "../lib/takedownNotify";
import { createAutoReport } from "./autoReport";
import type { Channel, Kind } from "../lib/reportTemplates";

// After a report is sent (TAKEDOWN_AUTOMATION_PLAN.md §11):
//   - replies: read the sender mailbox, match messages to reports by their [BM-...] tag, store
//     them, mark the takedown acknowledged and keep the recipient's ticket number;
//   - bounces: mark the report bounced and put the address on the never-send-to list for 30 days;
//   - follow-ups / escalation: still live and unanswered -> one follow-up; still live after longer ->
//     report to the next channel. Both go through the channel's mode like any automatic report.
// The system never answers a registrar's questions: replies are shown to the analysts.

const READ_EVERY_MS = 10 * 60_000;
const BOUNCE_BLOCK_DAYS = 30;
// Next channel when the earlier one hasn't acted.
const ESCALATE_TO: Partial<Record<Channel, Channel>> = { registrar: "host", host: "cert" };

// `read` is the mailbox reader (lib/orgMailer.ts readInbox); a test can pass its own.
export async function processReplies(orgId: string, now = new Date(), read: typeof readInbox = readInbox): Promise<number> {
  const sender = await withTenant(orgId, (tx) => tx.takedownSender.findUnique({ where: { organizationId: orgId } }));
  if (!sender?.readReplies || !canReadMailbox(sender.provider)) return 0;
  if (sender.repliesCheckedAt && now.getTime() - sender.repliesCheckedAt.getTime() < READ_EVERY_MS) return 0;

  // First run: the last 7 days. Later runs overlap by 10 minutes (messages are de-duplicated by id).
  const since = sender.repliesCheckedAt ? new Date(sender.repliesCheckedAt.getTime() - READ_EVERY_MS) : new Date(now.getTime() - 7 * 86400_000);
  let messages;
  try {
    const secrets = SenderSecretsSchema.parse(JSON.parse(decryptSecret(sender.config)));
    messages = await read(secrets, sender.fromAddress, since);
  } catch (err: any) {
    const error = String(err?.message ?? err).slice(0, 300);
    await withTenant(orgId, (tx) => tx.takedownSender.update({ where: { organizationId: orgId }, data: { repliesCheckedAt: now, repliesError: error } }));
    if (!sender.repliesError) await notifyTakedown(orgId, null, `Reading replies from ${sender.fromAddress} failed: ${error}`, { important: true });
    return 0;
  }

  const notices: Array<{ findingId: string; message: string }> = [];
  let matched = 0;
  await withTenant(orgId, async (tx) => {
    for (const m of messages) {
      // Our own sent copies (BCC archive into the same mailbox) aren't replies.
      if (m.from === sender.fromAddress.toLowerCase()) continue;
      const refs = reportRefsIn(`${m.subject}\n${m.snippet}`);
      if (refs.length === 0) continue;
      const action = await tx.takedownAction.findFirst({ where: { organizationId: orgId, reportRef: { in: refs }, status: "sent" } });
      if (!action) continue;
      if (await tx.takedownReply.findUnique({ where: { organizationId_providerMessageId: { organizationId: orgId, providerMessageId: m.id } } })) continue;
      const bounce = isBounce(m);
      if (!bounce && isOutOfOffice(m)) continue;
      const ticketRef = bounce ? null : ticketRefIn(m.subject, m.snippet);
      await tx.takedownReply.create({
        data: {
          organizationId: orgId,
          actionId: action.id,
          findingId: action.findingId,
          kind: bounce ? "bounce" : "reply",
          providerMessageId: m.id,
          fromAddress: m.from.slice(0, 254),
          subject: m.subject.slice(0, 500),
          snippet: m.snippet.slice(0, 1000),
          ticketRef,
          receivedAt: m.receivedAt,
        },
      });
      matched++;

      if (bounce) {
        const addresses = bouncedRecipients(m.snippet, action.to);
        for (const value of addresses) {
          await tx.takedownBlockedRecipient.upsert({
            where: { organizationId_value: { organizationId: orgId, value } },
            create: { organizationId: orgId, value, reason: "bounce", note: `Bounced report ${action.reportRef}`, expiresAt: new Date(now.getTime() + BOUNCE_BLOCK_DAYS * 86400_000), createdBy: "automatic" },
            update: { reason: "bounce", expiresAt: new Date(now.getTime() + BOUNCE_BLOCK_DAYS * 86400_000) },
          });
        }
        await tx.takedownAction.update({ where: { id: action.id }, data: { bouncedAt: m.receivedAt } });
        await recordAutomationEvent(tx, orgId, { userId: null, email: "automatic" }, "report.bounced", { actionId: action.id, addresses });
        notices.push({
          findingId: action.findingId,
          message: `Takedown report ${action.reportRef} bounced${addresses.length ? `: ${addresses.join(", ")} won't get reports for ${BOUNCE_BLOCK_DAYS} days` : ""}. Check the contact book.`,
        });
        continue;
      }

      await tx.takedownAction.update({
        where: { id: action.id },
        data: { replyCount: { increment: 1 }, lastReplyAt: m.receivedAt, ...(ticketRef && !action.ticketRef ? { ticketRef } : {}) },
      });
      if (action.takedownId) {
        const t = await tx.takedown.findUnique({ where: { id: action.takedownId } });
        if (t && t.status === "requested") {
          await tx.takedown.update({ where: { id: t.id }, data: { status: "acknowledged", ...(ticketRef ? { reference: ticketRef } : {}) } });
        } else if (t && ticketRef && t.reference === action.reportRef) {
          await tx.takedown.update({ where: { id: t.id }, data: { reference: ticketRef } });
        }
      }
      notices.push({ findingId: action.findingId, message: `Reply from ${m.from} about takedown report ${action.reportRef}${ticketRef ? ` (their ticket ${ticketRef})` : ""}` });
    }
    await tx.takedownSender.update({ where: { organizationId: orgId }, data: { repliesCheckedAt: now, repliesError: null } });
  });
  for (const n of notices) await notifyTakedown(orgId, n.findingId, n.message);
  return matched;
}

// Follow-ups and escalations for reports sent live (not redirected) whose site is still up.
export async function followUpAndEscalate(orgId: string, now = new Date()): Promise<number> {
  const notices: Array<{ findingId: string; message: string }> = [];
  const created = await withTenant(orgId, async (tx) => {
    const [automation, settings] = await Promise.all([
      tx.takedownAutomation.findUnique({ where: { organizationId: orgId } }),
      tx.takedownChannelSetting.findMany({ where: { organizationId: orgId } }),
    ]);
    if (!automation) return 0;
    // Same switches as new reports (stop-all, allowance, sender, authorization...).
    if (automationBlockers(await loadAutomationState(tx, orgId), null, now).length) return 0;
    const modes = new Map(settings.map((s) => [s.channel, s.mode]));
    const oldest = new Date(now.getTime() - Math.min(automation.followUpDays, automation.escalateDays) * 86400_000);
    const sent = await tx.takedownAction.findMany({
      where: { organizationId: orgId, status: "sent", redirected: false, kind: { in: ["first", "escalation"] }, sentAt: { lte: oldest }, bouncedAt: null },
      orderBy: { sentAt: "asc" },
      take: 200,
    });
    if (sent.length === 0) return 0;
    const routingData = await loadRoutingData(tx, orgId);
    let n = 0;
    for (const a of sent) {
      const finding = await tx.finding.findUnique({ where: { id: a.findingId }, select: { status: true, downSince: true, liveStreak: true, lastReactivatedAt: true } });
      if (!finding || finding.downSince || finding.liveStreak === 0 || finding.status === "false_positive" || finding.status === "resolved") continue;
      if (finding.lastReactivatedAt && a.sentAt && a.sentAt < finding.lastReactivatedAt) continue; // a new cycle starts from fresh first reports
      const age = now.getTime() - (a.sentAt?.getTime() ?? now.getTime());
      const previous = { id: a.id, sentAt: a.sentAt, ticketRef: a.ticketRef };

      // One follow-up per report, only while nobody answered.
      if (age >= automation.followUpDays * 86400_000 && !a.lastReplyAt && (modes.get(a.channel) ?? "off") !== "off") {
        const has = await tx.takedownAction.count({ where: { previousActionId: a.id, kind: "follow_up" } });
        if (!has) {
          n += await createAutoReport(tx, orgId, a.findingId, a.channel as Channel, modes.get(a.channel)!, automation, { via: "follow_on" }, routingData, now, notices, {
            kind: "follow_up",
            previous: { ...previous, to: a.to, cc: a.cc, bcc: a.bcc },
          });
        }
      }

      // Escalate to the next channel once, if that channel has nothing yet for this cycle.
      const next = ESCALATE_TO[a.channel as Channel];
      if (next && age >= automation.escalateDays * 86400_000 && (modes.get(next) ?? "off") !== "off") {
        const has = await tx.takedownAction.count({
          where: { findingId: a.findingId, channel: next, ...(finding.lastReactivatedAt ? { createdAt: { gt: finding.lastReactivatedAt } } : {}) },
        });
        if (!has) {
          n += await createAutoReport(tx, orgId, a.findingId, next, modes.get(next)!, automation, { via: "follow_on" }, routingData, now, notices, {
            kind: "escalation" as Kind,
            previous,
          });
        }
      }
    }
    return n;
  });
  for (const x of notices) await notifyTakedown(orgId, x.findingId, x.message);
  return created;
}
