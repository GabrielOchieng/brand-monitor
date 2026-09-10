import type { FastifyInstance } from "fastify";
import { authenticate } from "../lib/auth";
import { withTenant } from "../lib/tenant";

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

    return reply.send({ ...finding, evidence, scoreEvents });
  });

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
