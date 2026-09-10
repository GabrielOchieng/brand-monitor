import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { fromPrisma } from "pg-boss";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { boss, QUEUE_RECHECK } from "../queue/boss";
import type { RecheckJobData } from "../pipeline/recheckJob";
import { env } from "../env";
import { buildExplanationPrompt, generateExplanation } from "../lib/aiExplain";

// How long a "pending" AiExplanation row can sit before we treat it as an abandoned
// attempt (e.g. the server crashed mid-call) rather than a concurrent in-flight request.
const PENDING_STALE_MS = 30_000;

const FINDING_STATUSES = ["new", "investigating", "confirmed", "false_positive", "resolved"] as const;

const PatchFindingSchema = z.object({
  status: z.enum(FINDING_STATUSES).optional(),
  assigneeId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

const AddNoteSchema = z.object({
  body: z.string().min(1),
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
    const findings = await withTenant(request.auth!.orgId, (tx) =>
      tx.finding.findMany({
        orderBy: { riskScore: "desc" },
        include: { brand: { select: { name: true } } },
      })
    );
    return reply.send(
      findings.map((f) => ({
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
      }))
    );
  });

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

    return reply.send({ ...finding, evidence, scoreEvents, aiExplanation });
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

      return {
        brand: { id: brand.id, name: brand.name, primaryDomain: brand.primaryDomain },
        totalFindings: findings.length,
        bySeverity,
        lastRun,
      };
    });

    if (!summary) return reply.status(404).send({ error: "no_brand" });
    return reply.send(summary);
  });
}
