import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { MENTION_CATEGORIES, MENTION_SENTIMENTS } from "../pipeline/brandMentions";

const PAGE_SIZE = 20;
const SUMMARY_DAYS = 7;

const QuerySchema = z.object({
  category: z.enum([...MENTION_CATEGORIES, "unlabelled"]).optional(),
  sentiment: z.enum(MENTION_SENTIMENTS).optional(),
  platform: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

// The mentions feed (pipeline/brandMentions.ts): non-threat social posts naming the brand,
// newest first, one numbered page at a time, with a last-7-days breakdown for the summary
// strip. Offset paging is fine at this size (tens of posts a day per brand).
export async function mentionRoutes(app: FastifyInstance) {
  app.get("/api/brands/:id/mentions", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const { category, sentiment, platform, page } = parsed.data;

    const result = await withTenant(request.auth!.orgId, async (tx) => {
      const brand = await tx.brand.findUnique({ where: { id }, select: { id: true } });
      if (!brand) return null;

      const where = {
        brandId: id,
        ...(category === "unlabelled" ? { category: null } : category ? { category } : {}),
        ...(sentiment ? { sentiment } : {}),
        ...(platform ? { platform } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.brandMention.count({ where }),
        tx.brandMention.findMany({
          where,
          orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
      ]);

      const since = new Date(Date.now() - SUMMARY_DAYS * 24 * 60 * 60 * 1000);
      const recent = await tx.brandMention.groupBy({
        by: ["category", "sentiment"],
        where: { brandId: id, firstSeenAt: { gte: since } },
        _count: { _all: true },
      });
      const byCategory: Record<string, number> = {};
      const bySentiment: Record<string, number> = {};
      let recentTotal = 0;
      for (const g of recent) {
        const n = g._count._all;
        recentTotal += n;
        byCategory[g.category ?? "unlabelled"] = (byCategory[g.category ?? "unlabelled"] ?? 0) + n;
        bySentiment[g.sentiment ?? "unlabelled"] = (bySentiment[g.sentiment ?? "unlabelled"] ?? 0) + n;
      }
      return { total, rows, summary: { days: SUMMARY_DAYS, total: recentTotal, byCategory, bySentiment } };
    });
    if (!result) return reply.status(404).send({ error: "not_found" });

    return reply.send({
      mentions: result.rows,
      page,
      pageSize: PAGE_SIZE,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / PAGE_SIZE)),
      summary: result.summary,
    });
  });
}
