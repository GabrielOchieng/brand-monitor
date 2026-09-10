import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { runPipelineForBrand } from "../pipeline/runPipeline";

export async function pipelineRoutes(app: FastifyInstance) {
  app.post("/api/pipeline/run", async (request, reply) => {
    const brand = await prisma.brand.findFirst();
    if (!brand) return reply.status(404).send({ error: "no_brand_seeded" });

    const runId = await runPipelineForBrand(brand.id);
    return reply.send({ runId });
  });

  app.get("/api/pipeline/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await prisma.pipelineRun.findUnique({ where: { id } });
    if (!run) return reply.status(404).send({ error: "not_found" });
    return reply.send(run);
  });

  app.get("/api/pipeline/runs", async (request, reply) => {
    const runs = await prisma.pipelineRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
    return reply.send(runs);
  });
}
