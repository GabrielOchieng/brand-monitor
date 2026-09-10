import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { fromPrisma } from "pg-boss";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { boss, QUEUE_RECHECK } from "../queue/boss";
import type { RecheckJobData } from "../pipeline/recheckJob";
import { env } from "../env";
import { buildExplanationPrompt, generateExplanation } from "../lib/aiExplain";
import { TakedownStatusSchema, FindingStatusSchema, SeveritySchema } from "@brand-monitor/shared";
import { normalizeRegistrar, CORRELATION_WINDOW_DAYS } from "../pipeline/correlation";

// How long a "pending" AiExplanation row can sit before we treat it as an abandoned
// attempt (e.g. the server crashed mid-call) rather than a concurrent in-flight request.
const PENDING_STALE_MS = 30_000;

const FINDING_STATUSES = ["new", "investigating", "confirmed", "false_positive", "resolved"] as const;

const PatchFindingSchema = z.object({
  status: z.enum(FINDING_STATUSES).optional(),
  assigneeId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

const FindingsQuerySchema = z.object({
  status: FindingStatusSchema.optional(),
  severity: SeveritySchema.optional(),
  assigneeId: z.string().min(1).optional(), // the literal "unassigned" means assigneeId: null
  brandId: z.string().min(1).optional(),
  q: z.string().trim().max(200).optional(), // identifier search -- Prisma parameterizes `contains`, no injection risk
  sortBy: z.enum(["riskScore", "firstDetectedAt", "lastScannedAt"]).default("riskScore"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// Rejects an empty-effect request (neither field present) that would otherwise still
// "succeed" and still bump every matched row's updatedAt for zero reason.
const BulkPatchFindingSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    status: FindingStatusSchema.optional(),
    assigneeId: z.string().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined, {
    message: "must provide at least one of status or assigneeId",
  });

const AddNoteSchema = z.object({
  body: z.string().min(1),
});

const CreateTakedownSchema = z.object({
  provider: z.string().min(1).max(200),
  reference: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
});

const TERMINAL_TAKEDOWN_STATUSES = new Set(["completed", "rejected"]);

const PatchTakedownSchema = z.object({
  status: TakedownStatusSchema.optional(),
  reference: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
});

// Loopback/private/link-local/metadata hostnames rejected here as a fast, string-only
// pre-check for immediate user feedback -- NOT the authoritative SSRF gate, which can't
// be done by string matching alone (a domain can resolve to a private IP only at fetch
// time). The real gate is in the scanner service itself, right before navigation
// (apps/scanner/src/ssrfGuard.ts), which resolves the hostname first.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^169\.254\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
];

const ManualSubmitSchema = z.object({
  brandId: z.string().min(1),
  url: z.string().url(),
});

class InvalidAssigneeError extends Error {}

export async function findingsRoutes(app: FastifyInstance) {
  app.get("/api/findings", { preHandler: authenticate }, async (request, reply) => {
    const parsed = FindingsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const q = parsed.data;
    const orgId = request.auth!.orgId;

    // Default (no status/severity filter) shows everything -- don't silently hide real
    // production data the first time filtering ships. assigneeId/brandId need no extra
    // tenant validation beyond what RLS already provides: a garbage or foreign-org id in
    // either just yields zero rows via the brand_id IN (...) policy join, never a leak.
    const where: Prisma.FindingWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.brandId ? { brandId: q.brandId } : {}),
      ...(q.assigneeId ? { assigneeId: q.assigneeId === "unassigned" ? null : q.assigneeId } : {}),
      ...(q.q ? { identifier: { contains: q.q, mode: "insensitive" } } : {}),
    };

    const [findings, total] = await withTenant(orgId, (tx) =>
      Promise.all([
        tx.finding.findMany({
          where,
          orderBy: { [q.sortBy]: q.sortDir },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: { brand: { select: { name: true } } },
        }),
        tx.finding.count({ where }),
      ])
    );

    return reply.send({
      findings: findings.map((f) => ({
        id: f.id,
        identifier: f.identifier,
        type: f.type,
        source: f.source,
        riskScore: f.riskScore,
        severity: f.severity,
        status: f.status,
        firstDetectedAt: f.firstDetectedAt,
        lastScannedAt: f.lastScannedAt,
        assigneeId: f.assigneeId,
        tags: f.tags,
        brandName: f.brand.name,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  app.patch(
    "/api/findings/bulk",
    { preHandler: [authenticate, requireRole("owner", "admin", "analyst")] },
    async (request, reply) => {
      const parsed = BulkPatchFindingSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const { ids, status, assigneeId } = parsed.data;
      const orgId = request.auth!.orgId;

      try {
        const result = await withTenant(orgId, async (tx) => {
          // Same tenant-scoped membership check as the single-row PATCH below, done once
          // for the whole batch rather than per-id.
          if (assigneeId) {
            const membership = await tx.membership.findFirst({ where: { userId: assigneeId, organizationId: orgId } });
            if (!membership) throw new InvalidAssigneeError();
          }
          // RLS silently excludes any cross-tenant ids from this UPDATE ... WHERE id IN
          // (...) match rather than erroring -- updatedCount vs. requestedCount lets the
          // UI show "12 of 15 updated" without identifying *which* ids failed or why,
          // which would leak cross-tenant existence (same principle as the single-row
          // PATCH's P2025-as-404 below).
          return tx.finding.updateMany({
            where: { id: { in: ids } },
            data: {
              ...(status !== undefined ? { status } : {}),
              ...(assigneeId !== undefined ? { assigneeId } : {}),
            },
          });
        });
        return reply.send({ updatedCount: result.count, requestedCount: ids.length });
      } catch (err: any) {
        if (err instanceof InvalidAssigneeError) return reply.status(400).send({ error: "invalid_assignee" });
        throw err;
      }
    }
  );

  app.get("/api/findings/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const finding = await withTenant(request.auth!.orgId, (tx) =>
      tx.finding.findUnique({
        where: { id },
        include: { domainIntel: true, websiteIntel: true },
      })
    );
    // RLS means a cross-tenant id simply doesn't come back, same as a bad id -- both
    // correctly 404, never a distinguishable "forbidden" that would leak existence.
    if (!finding) return reply.status(404).send({ error: "not_found" });

    // Evidence/score events are append-only across every scan ever run (see the Scan
    // model) -- fetch only the LATEST scan's rows here, not the finding's full history,
    // or "why this score" would show every reason from every recheck ever run rather
    // than just the current one. A finding with no scan yet (freshly discovered, not
    // enriched) correctly comes back with empty arrays until its first recheck runs.
    const [evidence, scoreEvents] = finding.lastScanId
      ? await withTenant(request.auth!.orgId, (tx) =>
          Promise.all([
            tx.findingEvidence.findMany({ where: { scanId: finding.lastScanId! }, orderBy: { createdAt: "asc" } }),
            tx.findingScoreEvent.findMany({ where: { scanId: finding.lastScanId! }, orderBy: { createdAt: "asc" } }),
          ])
        )
      : [[], []];

    // Read-only lookup -- this route never triggers generation itself (that's the
    // explicit POST .../explain below), so a normal page load stays free/fast and the
    // costly LLM call only ever happens behind a deliberate user action.
    const aiExplanation = finding.lastScanId
      ? await withTenant(request.auth!.orgId, (tx) => tx.aiExplanation.findUnique({ where: { scanId: finding.lastScanId! } }))
      : null;

    // Distinguishes "the most recent recheck attempt got real website content" from
    // "it didn't" (a scan timeout, robots-disallow, or SSRF-guard rejection), without a
    // schema change: WebsiteIntel.scannedAt only ever advances on a SUCCESSFUL scan,
    // while Finding.lastScannedAt advances on every recheck attempt regardless of
    // outcome. A gap between them means the latest attempt failed to get data and
    // whatever's shown (if anything) is left over from an earlier successful scan, or
    // there was never one at all. The 5-minute tolerance is deliberately far smaller
    // than the minimum 20-minute recheck cadence, so it can't mistake "two attempts
    // close together" for "this attempt succeeded."
    const websiteDataCurrent = Boolean(
      finding.websiteIntel && Math.abs(finding.websiteIntel.scannedAt.getTime() - finding.lastScannedAt.getTime()) < 5 * 60 * 1000
    );

    return reply.send({ ...finding, evidence, scoreEvents, aiExplanation, websiteDataCurrent });
  });

  // Deliberately conservative v1: registrar + tight registration-time window is the only
  // trigger-worthy signal. Nameserver matching is dropped entirely -- several of our own
  // real findings share nameservers purely because they use the same cheap registrar's
  // generic default DNS (e.g. NameCheap's dns1/dns2.registrar-servers.com), not because of
  // any coordinated campaign; a naive "same nameservers" rule would constantly cluster
  // unrelated squatters together. IP match is included only as supporting context on an
  // already-matched pair, never a standalone trigger (shared hosting is too common alone).
  // No persisted "Campaign" entity, no background job -- this is a live, on-demand query,
  // cheap because a finding only gets a populated DomainIntel.registrar after its first
  // completed recheck, so the real per-brand working set is far smaller than the full
  // candidate count. `matchedOn` is returned explicitly (not just a bare array) so a future
  // persisted/graph-clustered version (ARCHITECTURE.md's later-phase Campaign model) can
  // swap in behind the same response shape without a frontend rewrite.
  app.get("/api/findings/:id/related", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const orgId = request.auth!.orgId;

    const result = await withTenant(orgId, async (tx) => {
      const finding = await tx.finding.findUnique({ where: { id }, include: { domainIntel: true } });
      if (!finding) return null;
      if (!finding.domainIntel?.registrar || !finding.domainIntel?.registeredAt) {
        return { relatedFindings: [], matchedOn: null, uncheckableCount: 0 };
      }

      const normalizedTarget = normalizeRegistrar(finding.domainIntel.registrar);
      const windowMs = CORRELATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const targetRegisteredAt = finding.domainIntel.registeredAt.getTime();

      // One query for every other finding under this SAME brand (explicit brandId scoping,
      // not just RLS -- RLS scopes by organization, not by brand, and an org can have
      // multiple brands; without this a finding under Brand A could match one under Brand
      // B purely because they share a cheap registrar the same week, a worse false
      // positive than the nameserver one since it's not even the same target). Filtering
      // and the window comparison happen in application code rather than a Prisma relation
      // filter on the optional 1:1 DomainIntel relation, whose "no row at all" vs.
      // "row exists with a null field" semantics aren't worth relying on here -- this is
      // cheap at the real per-brand working-set size (tens to low hundreds).
      const others = await tx.finding.findMany({
        where: { brandId: finding.brandId, id: { not: id } },
        include: { domainIntel: true },
      });

      const uncheckableCount = others.filter((f) => !f.domainIntel?.registeredAt).length;

      const relatedFindings = others
        .filter((f) => {
          if (!f.domainIntel?.registrar || !f.domainIntel?.registeredAt) return false;
          if (normalizeRegistrar(f.domainIntel.registrar) !== normalizedTarget) return false;
          return Math.abs(f.domainIntel.registeredAt.getTime() - targetRegisteredAt) <= windowMs;
        })
        .map((f) => ({
          id: f.id,
          identifier: f.identifier,
          riskScore: f.riskScore,
          severity: f.severity,
          registeredAt: f.domainIntel!.registeredAt,
          sharedIp: Boolean(f.domainIntel!.ip && finding.domainIntel!.ip && f.domainIntel!.ip === finding.domainIntel!.ip),
        }));

      return {
        relatedFindings,
        matchedOn: { registrar: finding.domainIntel.registrar, windowDays: CORRELATION_WINDOW_DAYS },
        uncheckableCount,
      };
    });

    if (!result) return reply.status(404).send({ error: "not_found" });
    return reply.send(result);
  });

  app.post(
    "/api/findings/:id/explain",
    { preHandler: [authenticate, requireRole("owner", "admin", "analyst")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = request.auth!.orgId;

      type Claim =
        | { kind: "not_found" }
        | { kind: "not_yet_scanned" }
        | { kind: "rate_limited" }
        | { kind: "cached"; record: any }
        | { kind: "claimed"; record: any };

      const claim: Claim = await withTenant(orgId, async (tx) => {
        const finding = await tx.finding.findUnique({
          where: { id },
          include: { brand: { select: { name: true } }, domainIntel: true, websiteIntel: true },
        });
        if (!finding) return { kind: "not_found" };
        const lastScanId = finding.lastScanId;
        if (!lastScanId) return { kind: "not_yet_scanned" };

        // Sliding 24h window (not a calendar-day bucket) counting every attempt,
        // including failures -- a retry storm against an unexplained scan still spends
        // real Anthropic budget even when it doesn't produce a usable result, so it must
        // still count. RLS already scopes this count to the calling org.
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const usedToday = await tx.aiExplanation.count({ where: { createdAt: { gte: since } } });
        if (usedToday >= env.aiExplanationDailyLimit) return { kind: "rate_limited" };

        const scoreEvents = await tx.findingScoreEvent.findMany({ where: { scanId: lastScanId }, orderBy: { createdAt: "asc" } });
        const prompt = buildExplanationPrompt({
          identifier: finding.identifier,
          brandName: finding.brand.name,
          riskScore: finding.riskScore,
          severity: finding.severity,
          scoreEvents,
          domainIntel: finding.domainIntel,
          websiteIntel: finding.websiteIntel,
        });

        const existing = await tx.aiExplanation.findUnique({ where: { scanId: lastScanId } });
        if (existing) {
          const isStalePending = existing.status === "pending" && Date.now() - existing.updatedAt.getTime() > PENDING_STALE_MS;
          if (existing.status === "succeeded" || (existing.status === "pending" && !isStalePending)) {
            return { kind: "cached", record: existing };
          }
          // status "failed", or an abandoned stale "pending" -- retry.
          const retried = await tx.aiExplanation.update({
            where: { scanId: lastScanId },
            data: { status: "pending", prompt, model: env.anthropicModel, error: null },
          });
          return { kind: "claimed", record: retried };
        }

        try {
          // This insert is the mutex: a concurrent second request racing to explain the
          // same not-yet-explained scan will fail on the scanId unique constraint below,
          // rather than both calling the LLM.
          const created = await tx.aiExplanation.create({
            data: { scanId: lastScanId, findingId: finding.id, prompt, model: env.anthropicModel, status: "pending" },
          });
          return { kind: "claimed", record: created };
        } catch (err: any) {
          if (err?.code === "P2002") {
            const race = await tx.aiExplanation.findUniqueOrThrow({ where: { scanId: lastScanId } });
            return { kind: "cached", record: race };
          }
          throw err;
        }
      });

      if (claim.kind === "not_found") return reply.status(404).send({ error: "not_found" });
      if (claim.kind === "not_yet_scanned") return reply.status(400).send({ error: "not_yet_scanned" });
      if (claim.kind === "rate_limited") return reply.status(429).send({ error: "rate_limited" });
      if (claim.kind === "cached") return reply.send(claim.record);

      // We own this pending row -- call the LLM outside any transaction (never hold a
      // Postgres transaction open across a slow external call, same rule every other
      // network call in this codebase follows). This runs synchronously in the request
      // (a deliberate deviation from this codebase's usual "slow external I/O goes in a
      // pg-boss job" rule for discovery/recheck/alert-dispatch): it's user-initiated,
      // there's no way to make "click generate" not involve waiting, and latency here is
      // normally 1-3s -- well inside a normal HTTP timeout. Revisit only if real usage
      // shows p95 latency creeping past ~8-10s.
      try {
        const response = await generateExplanation(claim.record.prompt);
        const updated = await withTenant(orgId, (tx) =>
          tx.aiExplanation.update({ where: { id: claim.record.id }, data: { status: "succeeded", response } })
        );
        return reply.send(updated);
      } catch (err: any) {
        const updated = await withTenant(orgId, (tx) =>
          tx.aiExplanation.update({ where: { id: claim.record.id }, data: { status: "failed", error: String(err?.message ?? err) } })
        );
        return reply.send(updated);
      }
    }
  );

  app.patch(
    "/api/findings/:id",
    { preHandler: [authenticate, requireRole("owner", "admin", "analyst")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = PatchFindingSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const { status, assigneeId, tags } = parsed.data;
      const orgId = request.auth!.orgId;

      try {
        const updated = await withTenant(orgId, async (tx) => {
          // A raw Finding.assigneeId -> User.id FK isn't tenant-scoped (users exist
          // globally; RLS on `users` only gates reads, not what a foreign key may point
          // at) -- without this check an admin could assign a finding to a user with no
          // relationship to this org. `memberships` IS RLS-scoped by organization_id, so
          // this lookup is a correct tenant-safe existence check. assigneeId === null
          // (explicit unassign) skips it.
          if (assigneeId) {
            const membership = await tx.membership.findFirst({ where: { userId: assigneeId, organizationId: orgId } });
            if (!membership) throw new InvalidAssigneeError();
          }

          return tx.finding.update({
            where: { id },
            data: {
              ...(status !== undefined ? { status } : {}),
              ...(assigneeId !== undefined ? { assigneeId } : {}),
              ...(tags !== undefined ? { tags } : {}),
            },
          });
        });
        return reply.send(updated);
      } catch (err: any) {
        if (err instanceof InvalidAssigneeError) return reply.status(400).send({ error: "invalid_assignee" });
        // RLS makes a cross-tenant id simply not match any row -- same "not found" shape
        // as a bad id, same reasoning as the GET route above.
        if (err?.code === "P2025") return reply.status(404).send({ error: "not_found" });
        throw err;
      }
    }
  );

  app.get("/api/findings/:id/notes", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const notes = await withTenant(request.auth!.orgId, (tx) =>
      tx.findingNote.findMany({ where: { findingId: id }, orderBy: { createdAt: "asc" } })
    );
    return reply.send(notes);
  });

  app.post(
    "/api/findings/:id/notes",
    { preHandler: [authenticate, requireRole("owner", "admin", "analyst")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = AddNoteSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const orgId = request.auth!.orgId;
      // authorId is always the caller's own id from the verified token, never accepted
      // from the request body -- otherwise a client could post a note "as" a teammate.
      const authorId = request.auth!.userId;

      const note = await withTenant(orgId, async (tx) => {
        const finding = await tx.finding.findUnique({ where: { id } });
        if (!finding) return null;
        return tx.findingNote.create({ data: { findingId: id, authorId, body: parsed.data.body } });
      });
      if (!note) return reply.status(404).send({ error: "not_found" });
      return reply.status(201).send(note);
    }
  );

  app.get("/api/findings/:id/takedowns", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const takedowns = await withTenant(request.auth!.orgId, (tx) =>
      tx.takedown.findMany({ where: { findingId: id }, orderBy: { createdAt: "asc" } })
    );
    return reply.send(takedowns);
  });

  app.post(
    "/api/findings/:id/takedowns",
    { preHandler: [authenticate, requireRole("owner", "admin", "analyst")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = CreateTakedownSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const orgId = request.auth!.orgId;
      // requestedById is always the caller's own id, never accepted from the request
      // body -- same rule as FindingNote.authorId, and for the same reason.
      const requestedById = request.auth!.userId;

      const takedown = await withTenant(orgId, async (tx) => {
        const finding = await tx.finding.findUnique({ where: { id } });
        if (!finding) return null;
        return tx.takedown.create({
          data: { findingId: id, requestedById, ...parsed.data },
        });
      });
      if (!takedown) return reply.status(404).send({ error: "not_found" });
      return reply.status(201).send(takedown);
    }
  );

  app.patch(
    "/api/findings/:id/takedowns/:takedownId",
    { preHandler: [authenticate, requireRole("owner", "admin", "analyst")] },
    async (request, reply) => {
      const { id, takedownId } = request.params as { id: string; takedownId: string };
      const parsed = PatchTakedownSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const { status, reference, notes } = parsed.data;
      const orgId = request.auth!.orgId;

      const updated = await withTenant(orgId, async (tx) => {
        // One compound where enforces "this takedown belongs to this finding" as part of
        // the write itself -- no separate fetch-then-verify round trip, and no window
        // between a check and an update. A takedownId belonging to a different finding
        // (same org or cross-tenant) 404s exactly like a nonexistent id, same ambiguity
        // this file already preserves elsewhere to avoid leaking existence.
        const result = await tx.takedown.updateMany({
          where: { id: takedownId, findingId: id },
          data: {
            ...(status !== undefined ? { status } : {}),
            ...(reference !== undefined ? { reference } : {}),
            ...(notes !== undefined ? { notes } : {}),
          },
        });
        if (result.count === 0) return null;

        // resolvedAt is a first-ever-resolved fact -- set once, on the transition into a
        // terminal status, and never overwritten by a later correction. The `resolvedAt:
        // null` guard in the where clause makes this a no-op if it's already set, rather
        // than a second round trip needing its own read-then-write.
        if (status && TERMINAL_TAKEDOWN_STATUSES.has(status)) {
          await tx.takedown.updateMany({
            where: { id: takedownId, findingId: id, resolvedAt: null },
            data: { resolvedAt: new Date() },
          });
        }

        return tx.takedown.findUniqueOrThrow({ where: { id: takedownId } });
      });

      if (!updated) return reply.status(404).send({ error: "not_found" });
      return reply.send(updated);
    }
  );

  app.post(
    "/api/findings/manual-submit",
    { preHandler: [authenticate, requireRole("owner", "admin", "analyst")] },
    async (request, reply) => {
      const parsed = ManualSubmitSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const orgId = request.auth!.orgId;

      let target: URL;
      try {
        target = new URL(parsed.data.url);
      } catch {
        return reply.status(400).send({ error: "invalid_url" });
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        return reply.status(400).send({ error: "invalid_url" });
      }
      if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(target.hostname))) {
        return reply.status(400).send({ error: "target_not_allowed" });
      }

      // Bare domain (no path/query/hash) is structurally identical to what discovery
      // produces -- rides recheckJob.ts's unmodified domain-enrichment path. Anything
      // else (a social-media profile, a specific page) is scored as its own URL -- see
      // the type-branch in recheckJob.ts.
      const isBareDomain = (target.pathname === "" || target.pathname === "/") && !target.search && !target.hash;
      const type = isBareDomain ? "domain" : "url";
      const identifier = isBareDomain ? target.hostname.toLowerCase() : target.toString();

      const result = await withTenant(orgId, async (tx) => {
        const brand = await tx.brand.findUnique({ where: { id: parsed.data.brandId } });
        if (!brand) return null;

        // Re-submitting the same URL later is a no-op dedup + fresh recheck, not a
        // duplicate finding, thanks to the existing @@unique([brandId, identifier]).
        const finding = await tx.finding.upsert({
          where: { brandId_identifier: { brandId: brand.id, identifier } },
          create: { brandId: brand.id, type, identifier, source: "manual_submission", nextScanAt: new Date() },
          update: { nextScanAt: new Date() },
        });

        const data: RecheckJobData = { findingId: finding.id, organizationId: orgId, triggeredBy: "manual" };
        await boss.send(QUEUE_RECHECK, data, { db: fromPrisma(tx), singletonKey: finding.id });
        return finding;
      });

      if (!result) return reply.status(404).send({ error: "no_brand" });
      return reply.status(201).send(result);
    }
  );

  app.get("/api/dashboard/summary", { preHandler: authenticate }, async (request, reply) => {
    const { brandId } = request.query as { brandId?: string };

    const summary = await withTenant(request.auth!.orgId, async (tx) => {
      const brand = brandId
        ? await tx.brand.findUnique({ where: { id: brandId } })
        : await tx.brand.findFirst({ orderBy: { createdAt: "asc" } });
      if (!brand) return null;

      const findings = await tx.finding.findMany({ where: { brandId: brand.id } });
      const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 } as Record<string, number>;
      for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

      const lastRun = await tx.pipelineRun.findFirst({
        where: { brandId: brand.id },
        orderBy: { startedAt: "desc" },
      });

      // Whether a visual-similarity reference screenshot has ever been captured for this
      // brand -- lets the dashboard link to it (served via the existing /screenshots/
      // static route, saved as brand-${brandId}.png) so a human can sanity-check it
      // rather than trusting a cached hash blindly.
      const visualBaseline = await tx.brandAsset.findFirst({ where: { brandId: brand.id, type: "screenshot" } });

      return {
        brand: { id: brand.id, name: brand.name, primaryDomain: brand.primaryDomain, hasVisualBaseline: Boolean(visualBaseline) },
        totalFindings: findings.length,
        bySeverity,
        lastRun,
      };
    });

    if (!summary) return reply.status(404).send({ error: "no_brand" });
    return reply.send(summary);
  });
}
