import type { FastifyInstance } from "fastify";
import { prisma } from "../db";

export async function findingsRoutes(app: FastifyInstance) {
  app.get("/api/findings", async (request, reply) => {
    const findings = await prisma.finding.findMany({
      orderBy: { riskScore: "desc" },
      include: { brand: { select: { name: true } } },
    });
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

  app.get("/api/findings/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const finding = await prisma.finding.findUnique({
      where: { id },
      include: {
        domainIntel: true,
        websiteIntel: true,
        evidence: { orderBy: { createdAt: "asc" } },
        scoreEvents: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!finding) return reply.status(404).send({ error: "not_found" });
    return reply.send(finding);
  });

  app.get("/api/dashboard/summary", async (request, reply) => {
    const brand = await prisma.brand.findFirst();
    if (!brand) return reply.status(404).send({ error: "no_brand_seeded" });

    const findings = await prisma.finding.findMany({ where: { brandId: brand.id } });
    const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 } as Record<string, number>;
    for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

    const lastRun = await prisma.pipelineRun.findFirst({
      where: { brandId: brand.id },
      orderBy: { startedAt: "desc" },
    });

    return reply.send({
      brand: { id: brand.id, name: brand.name, primaryDomain: brand.primaryDomain },
      totalFindings: findings.length,
      bySeverity,
      lastRun,
    });
  });
}
