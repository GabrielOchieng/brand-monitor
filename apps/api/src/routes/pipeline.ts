import type { FastifyInstance } from "fastify";
import { fromPrisma } from "pg-boss";
import { authenticate, requireRole } from "../lib/auth";
import { allowDiscoveryRun, allowSocialSearchRun } from "../lib/rateLimit";
import { env } from "../env";
import { withTenant } from "../lib/tenant";
import { brandPausedInTx } from "../lib/monitoredBrands";
import { boss, QUEUE_DISCOVERY, QUEUE_SOCIAL_SEARCH_MONITOR } from "../queue/boss";
import type { DiscoveryJobData } from "../pipeline/discoveryJob";

export async function pipelineRoutes(app: FastifyInstance) {
  // Viewers can't start runs: each one is thousands of outbound DNS queries.
  app.post("/api/pipeline/run", { preHandler: [authenticate, requireRole("owner", "admin", "analyst")] }, async (request, reply) => {
    const { brandId } = (request.body ?? {}) as { brandId?: string };
    const orgId = request.auth!.orgId;
    if (!allowDiscoveryRun(orgId)) return reply.status(429).send({ error: "too_many_discovery_runs" });

    // PipelineRun creation and the job enqueue happen in one transaction (via pg-boss's
    // fromPrisma adapter) -- a crash between the two is impossible, unlike a plain
    // create-then-send that could leave an orphaned "running" row with no job behind it.
    const result = await withTenant(orgId, async (tx) => {
      const brand = brandId
        ? await tx.brand.findUnique({ where: { id: brandId } })
        : await tx.brand.findFirst({ orderBy: { createdAt: "asc" } });
      if (!brand) return null;
      if (await brandPausedInTx(tx, brand.id)) return "paused" as const;

      const run = await tx.pipelineRun.create({ data: { brandId: brand.id, status: "running" } });
      const data: DiscoveryJobData = { runId: run.id, brandId: brand.id, organizationId: orgId };
      await boss.send(QUEUE_DISCOVERY, data, { db: fromPrisma(tx), singletonKey: brand.id });
      return run;
    });

    if (!result) return reply.status(404).send({ error: "no_brand" });
    if (result === "paused") return reply.status(409).send({ error: "monitoring_paused" });
    return reply.send({ runId: result.id });
  });

  // "Search social media now" on the dashboard. Owners/admins only and 3 a day per org:
  // each run spends Tavily's metered free credits (lib/tavily.ts). Queued, not run inline --
  // six searches take ~20s; the job leaves an in-app notification when done.
  app.post("/api/pipeline/social-search", { preHandler: [authenticate, requireRole("owner", "admin")] }, async (request, reply) => {
    const { brandId } = (request.body ?? {}) as { brandId?: string };
    const orgId = request.auth!.orgId;
    if (!env.tavilyApiKey) return reply.status(400).send({ error: "social_search_not_configured" });
    if (!brandId) return reply.status(400).send({ error: "invalid_request" });
    const brand = await withTenant(orgId, async (tx) => {
      const b = await tx.brand.findUnique({ where: { id: brandId }, select: { id: true } });
      return b && { ...b, paused: await brandPausedInTx(tx, b.id) };
    });
    if (!brand) return reply.status(404).send({ error: "no_brand" });
    if (brand.paused) return reply.status(409).send({ error: "monitoring_paused" });
    if (!allowSocialSearchRun(orgId)) return reply.status(429).send({ error: "too_many_social_searches" });
    // singletonKey: a second click while one is queued for this brand doesn't queue another.
    await boss.send(QUEUE_SOCIAL_SEARCH_MONITOR, { kind: "manual", brandId, organizationId: orgId }, { singletonKey: `manual-social-${brandId}` });
    return reply.status(202).send({ queued: true });
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
