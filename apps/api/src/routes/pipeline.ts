import type { FastifyInstance } from "fastify";
import { authenticate } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { runPipelineForBrand } from "../pipeline/runPipeline";

export async function pipelineRoutes(app: FastifyInstance) {
  app.post("/api/pipeline/run", { preHandler: authenticate }, async (request, reply) => {
    const { brandId } = (request.body ?? {}) as { brandId?: string };
    const orgId = request.auth!.orgId;

    const brand = await withTenant(orgId, (tx) =>
      brandId ? tx.brand.findUnique({ where: { id: brandId } }) : tx.brand.findFirst({ orderBy: { createdAt: "asc" } })
    );
    if (!brand) return reply.status(404).send({ error: "no_brand" });

    const runId = await runPipelineForBrand(orgId, brand.id);
    return reply.send({ runId });
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
