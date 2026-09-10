import type { FastifyInstance } from "fastify";
import { fromPrisma } from "pg-boss";
import { authenticate } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { boss, QUEUE_DISCOVERY } from "../queue/boss";
import type { DiscoveryJobData } from "../pipeline/discoveryJob";

export async function pipelineRoutes(app: FastifyInstance) {
  app.post("/api/pipeline/run", { preHandler: authenticate }, async (request, reply) => {
    const { brandId } = (request.body ?? {}) as { brandId?: string };
    const orgId = request.auth!.orgId;

    // PipelineRun creation and the job enqueue happen in one transaction (via pg-boss's
    // fromPrisma adapter) -- a crash between the two is impossible, unlike a plain
    // create-then-send that could leave an orphaned "running" row with no job behind it.
    const result = await withTenant(orgId, async (tx) => {
      const brand = brandId
        ? await tx.brand.findUnique({ where: { id: brandId } })
        : await tx.brand.findFirst({ orderBy: { createdAt: "asc" } });
      if (!brand) return null;

      const run = await tx.pipelineRun.create({ data: { brandId: brand.id, status: "running" } });
      const data: DiscoveryJobData = { runId: run.id, brandId: brand.id, organizationId: orgId };
      await boss.send(QUEUE_DISCOVERY, data, { db: fromPrisma(tx), singletonKey: brand.id });
      return run;
    });

    if (!result) return reply.status(404).send({ error: "no_brand" });
    return reply.send({ runId: result.id });
  });

  app.get("/api/pipeline/runs/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await withTenant(request.auth!.orgId, (tx) => tx.pipelineRun.findUnique({ where: { id } }));
    if (!run) return reply.status(404).send({ error: "not_found" });
    return reply.send(run);
  });

  app.get("/api/pipeline/runs", { preHandler: authenticate }, async (request, reply) => {
    const runs = await withTenant(request.auth!.orgId, (tx) =>
      tx.pipelineRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 })
    );
    return reply.send(runs);
  });
}
