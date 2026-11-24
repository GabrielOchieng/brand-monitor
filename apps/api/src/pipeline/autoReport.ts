import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { env } from "../env";
import { initialStatus, sendAfterFor } from "../lib/takedownPolicy";
import { loadReportContext, resolveTemplate } from "../lib/reportContext";
import { newReportRef, renderTemplate, type Channel, type Kind } from "../lib/reportTemplates";
import { loadRoutingData, recipientProblems, resolveRouting } from "../lib/recipients";

// Creates one automatic takedown report (first report, follow-up or escalation): renders the
// published template, routes it (lib/recipients.ts) and sets its starting status from the stage
// and the channel's mode (lib/takedownPolicy.ts). Used by takedownDispatch.ts and takedownReplies.ts.

export interface FollowOn {
  kind: Kind;
  // The report this one follows on from (a follow-up keeps its recipients).
  previous: { id: string; sentAt: Date | null; ticketRef: string | null; to?: string[]; cc?: string[]; bcc?: string[] };
}

export async function createAutoReport(
  tx: Prisma.TransactionClient,
  orgId: string,
  findingId: string,
  channel: Channel,
  mode: string,
  automation: { stage: string; vetoHours: number; confirmedSkipsVeto: boolean },
  policy: { via: "confirmed" | "signals" | "follow_on" } & Record<string, unknown>,
  routingData: Awaited<ReturnType<typeof loadRoutingData>>,
  now: Date,
  notices: Array<{ findingId: string; message: string }>,
  followOn?: FollowOn
): Promise<number> {
  const kind: Kind = followOn?.kind ?? "first";
  let reportRef = newReportRef(randomBytes);
  while (await tx.takedownAction.findUnique({ where: { reportRef }, select: { id: true } })) reportRef = newReportRef(randomBytes);
  const loaded = await loadReportContext(tx, orgId, findingId, {
    reportRef,
    apiOrigin: env.apiPublicUrl,
    previous: followOn ? { sentAt: followOn.previous.sentAt, ticketRef: followOn.previous.ticketRef } : null,
  });
  if (!loaded) return 0;
  const routing = resolveRouting(channel, loaded.finding.facts, routingData.rules, routingData.fixed.get(channel) ?? null, routingData.ownDomains, routingData.blocked, now);
  // A follow-up goes to whoever got the first report (minus anything blocked since, e.g. a bounce).
  if (followOn?.previous.to?.length) {
    const kept = { to: followOn.previous.to, cc: followOn.previous.cc ?? [], bcc: followOn.previous.bcc ?? [] };
    const bad = new Set(recipientProblems(kept, routingData.ownDomains, routingData.blocked, now).map((x) => `${x.field}:${x.address}`));
    routing.to = kept.to.filter((a) => !bad.has(`to:${a}`));
    routing.cc = kept.cc.filter((a) => !bad.has(`cc:${a}`));
    routing.bcc = kept.bcc.filter((a) => !bad.has(`bcc:${a}`));
    routing.method = routing.to.length ? "email" : "none";
    routing.why = "Follow-up to the recipients of the first report.";
  }
  if (routing.method === "skip") return 0;
  const language = routing.language ?? "en";
  const template = await resolveTemplate(tx, orgId, loaded.finding.brandId, channel, kind, language);
  const rendered = renderTemplate(template, loaded.context);
  const status = initialStatus(automation.stage, mode, routing.method);
  const sendAfter = status === "pending_veto" || status === "queued" ? sendAfterFor(mode, policy.via === "confirmed", automation, now) : null;
  await tx.takedownAction.create({
    data: {
      organizationId: orgId,
      brandId: loaded.finding.brandId,
      findingId,
      channel,
      kind,
      language,
      status,
      previousActionId: followOn?.previous.id ?? null,
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
  const target = `${loaded.finding.identifier}${kind === "first" ? "" : ` (${kind === "follow_up" ? "follow-up" : "escalation"})`}`;
  if (status === "pending_veto") notices.push({ findingId, message: `Takedown report to the ${channel} for ${target} goes out ${sendAfter && sendAfter > now ? `at ${sendAfter.toISOString().slice(11, 16)} UTC` : "shortly"} unless cancelled` });
  else if (status === "awaiting_approval") notices.push({ findingId, message: `Takedown report to the ${channel} for ${target} is waiting for approval` });
  else if (status === "manual") notices.push({ findingId, message: `Takedown report to the ${channel} for ${target} needs to be sent by hand (web form or no address)` });
  return 1;
}

