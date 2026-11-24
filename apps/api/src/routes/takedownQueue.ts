import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { automationBlockers, loadAutomationState, recordAutomationEvent } from "../lib/takedownAutomation";
import { ACTION_STATUSES } from "../lib/takedownPolicy";
import { sendAction } from "../lib/takedownSend";
import { computeMetrics } from "../lib/takedownMetrics";

// The takedown queue (TAKEDOWN_AUTOMATION_PLAN.md §9-§10): every report the org has, across
// findings, and what analysts do with them -- approve and send, cancel during the veto window,
// review shadow-mode results, and close manual (web form) tasks.

const ANALYST_UP = ["owner", "admin", "analyst"];

async function actorEmail(tx: Prisma.TransactionClient, userId: string) {
  return (await tx.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? userId;
}

const ListQuery = z.object({
  status: z.enum(ACTION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function takedownQueueRoutes(app: FastifyInstance) {
  app.get("/api/takedown-queue", { preHandler: authenticate }, async (request, reply) => {
    const q = ListQuery.safeParse(request.query);
    if (!q.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const [actions, counts] = await Promise.all([
        tx.takedownAction.findMany({
          where: { organizationId: orgId, ...(q.data.status ? { status: q.data.status } : { status: { not: "draft" } }) },
          orderBy: [{ updatedAt: "desc" }],
          take: q.data.limit,
          select: {
            id: true,
            findingId: true,
            brandId: true,
            channel: true,
            kind: true,
            status: true,
            reportRef: true,
            to: true,
            subject: true,
            createdAuto: true,
            sendAfter: true,
            sentAt: true,
            holdReason: true,
            skipReason: true,
            error: true,
            redirected: true,
            shadowVerdict: true,
            replyCount: true,
            lastReplyAt: true,
            ticketRef: true,
            bouncedAt: true,
            routing: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        tx.takedownAction.groupBy({ by: ["status"], where: { organizationId: orgId }, _count: { _all: true } }),
      ]);
      const findings = await tx.finding.findMany({
        where: { id: { in: [...new Set(actions.map((a) => a.findingId))] } },
        select: { id: true, identifier: true, type: true, severity: true, brand: { select: { name: true } } },
      });
      const byId = new Map(findings.map((f) => [f.id, f]));
      return {
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
        actions: actions.map((a) => ({ ...a, finding: byId.get(a.findingId) ?? null })),
      };
    });
  });

  // Approve and send now. Works for a draft, a report waiting for approval or its veto window,
  // or a failed one (retry). Every switch must be on, and shadow mode never sends.
  app.post("/api/takedown-actions/:id/send", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    const prep = await withTenant(orgId, async (tx) => {
      const action = await tx.takedownAction.findFirst({ where: { id, organizationId: orgId } });
      if (!action) return { error: "not_found" as const };
      if (!["draft", "awaiting_approval", "pending_veto", "failed", "queued"].includes(action.status)) return { error: "not_sendable" as const };
      if (action.to.length === 0 && (action.routing as { method?: string } | null)?.method !== "api") return { error: "no_recipient" as const };
      const automation = await tx.takedownAutomation.findUnique({ where: { organizationId: orgId } });
      if (!automation || automation.stage === "shadow") return { error: "shadow_mode" as const };
      const brand = await tx.brand.findUnique({ where: { id: action.brandId }, select: { id: true, autoTakedownEnabled: true, monitoringPausedAt: true } });
      const blockers = automationBlockers(await loadAutomationState(tx, orgId), brand);
      if (blockers.length) return { error: "automation_blocked" as const, blockers };
      const email = await actorEmail(tx, request.auth!.userId);
      await tx.takedownAction.update({ where: { id }, data: { status: "queued", approvedBy: email, error: null, holdReason: null } });
      await recordAutomationEvent(tx, orgId, { userId: request.auth!.userId, email }, "report.approve", { actionId: id, findingId: action.findingId, channel: action.channel });
      return { ok: true as const };
    });
    if ("error" in prep) {
      const status = prep.error === "not_found" ? 404 : prep.error === "not_sendable" ? 409 : 400;
      return reply.status(status).send(prep);
    }
    const outcome = await sendAction(orgId, id);
    return reply.send(outcome);
  });

  app.post("/api/takedown-actions/:id/cancel", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const email = await actorEmail(tx, request.auth!.userId);
      const { count } = await tx.takedownAction.updateMany({
        where: { id, organizationId: orgId, status: { in: ["awaiting_approval", "pending_veto", "queued", "manual", "shadow", "failed"] } },
        data: { status: "cancelled", cancelledBy: email, holdReason: null },
      });
      if (count === 0) return reply.status(409).send({ error: "not_cancellable" });
      await recordAutomationEvent(tx, orgId, { userId: request.auth!.userId, email }, "report.cancel", { actionId: id });
      return reply.send({ ok: true });
    });
  });

  // Shadow mode review: was this report right to make?
  app.post("/api/takedown-actions/:id/verdict", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ verdict: z.enum(["right", "wrong"]).nullable() }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const email = await actorEmail(tx, request.auth!.userId);
      const { count } = await tx.takedownAction.updateMany({
        where: { id, organizationId: orgId, status: "shadow" },
        data: { shadowVerdict: parsed.data.verdict, shadowVerdictBy: parsed.data.verdict ? email : null },
      });
      if (count === 0) return reply.status(404).send({ error: "not_found" });
      return reply.send({ ok: true });
    });
  });

  // A manual task (web form, or sent from someone's own mail client) was done by hand: log it
  // like a sent report, so the tracker and follow-ups know about it.
  app.post("/api/takedown-actions/:id/mark-reported", { preHandler: [authenticate, requireRole(...ANALYST_UP)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ reference: z.string().trim().max(200).optional().nullable(), provider: z.string().trim().min(1).max(200) }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    return withTenant(orgId, async (tx) => {
      const action = await tx.takedownAction.findFirst({ where: { id, organizationId: orgId, status: { in: ["manual", "draft", "failed", "awaiting_approval", "pending_veto"] } } });
      if (!action) return reply.status(409).send({ error: "not_sendable" });
      const email = await actorEmail(tx, request.auth!.userId);
      const takedown = await tx.takedown.create({
        data: {
          findingId: action.findingId,
          provider: parsed.data.provider,
          reference: parsed.data.reference || action.reportRef,
          notes: `Reported by hand by ${email} (report ${action.reportRef})`,
          requestedById: request.auth!.userId,
        },
      });
      await tx.takedownAction.update({ where: { id }, data: { status: "sent", sentAt: new Date(), approvedBy: email, takedownId: takedown.id, deliveredTo: [], holdReason: null } });
      await recordAutomationEvent(tx, orgId, { userId: request.auth!.userId, email }, "report.manual_done", { actionId: id, provider: parsed.data.provider });
      return reply.send({ ok: true });
    });
  });

  // Results: how sent reports fared (lib/takedownMetrics.ts). Real recipients only, no test deliveries.
  app.get("/api/takedown-metrics", { preHandler: authenticate }, async (request, reply) => {
    const q = z.object({ days: z.coerce.number().int().min(7).max(730).default(90) }).safeParse(request.query);
    if (!q.success) return reply.status(400).send({ error: "invalid_request" });
    const orgId = request.auth!.orgId;
    const since = new Date(Date.now() - q.data.days * 86400_000);
    return withTenant(orgId, async (tx) => {
      const actions = await tx.takedownAction.findMany({
        where: { organizationId: orgId, status: "sent", redirected: false, sentAt: { gte: since } },
        select: { id: true, findingId: true, channel: true, to: true, sentAt: true, takedownId: true, replyCount: true },
      });
      const [takedowns, replies, intel] = await Promise.all([
        tx.takedown.findMany({ where: { id: { in: actions.map((a) => a.takedownId).filter((x): x is string => !!x) } }, select: { id: true, status: true, resolvedAt: true } }),
        tx.takedownReply.findMany({ where: { organizationId: orgId, kind: "reply", actionId: { in: actions.map((a) => a.id) } }, select: { actionId: true, receivedAt: true } }),
        tx.domainIntel.findMany({ where: { findingId: { in: [...new Set(actions.map((a) => a.findingId))] } }, select: { findingId: true, registrar: true, hostingOrg: true } }),
      ]);
      const td = new Map(takedowns.map((t) => [t.id, t]));
      const di = new Map(intel.map((i) => [i.findingId, i]));
      const firstReply = new Map<string, Date>();
      for (const r of replies) if (!firstReply.has(r.actionId) || r.receivedAt < firstReply.get(r.actionId)!) firstReply.set(r.actionId, r.receivedAt);
      const rows = actions.map((a) => {
        const t = a.takedownId ? td.get(a.takedownId) : undefined;
        const i = di.get(a.findingId);
        const provider = a.channel === "registrar" ? (i?.registrar ?? "Unknown registrar") : a.channel === "host" ? (i?.hostingOrg ?? a.to[0] ?? "Unknown host") : (a.to[0] ?? "Web form");
        return {
          channel: a.channel,
          provider,
          sentAt: a.sentAt!,
          firstReplyAt: firstReply.get(a.id) ?? null,
          acknowledged: a.replyCount > 0 || t?.status === "acknowledged" || t?.status === "completed",
          completedAt: t?.status === "completed" ? (t.resolvedAt ?? null) : null,
          rejected: t?.status === "rejected",
        };
      });
      return { days: q.data.days, ...computeMetrics(rows) };
    });
  });
}
