import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../lib/auth";
import { withTenant } from "../lib/tenant";
import { MENTION_CATEGORIES, MENTION_SENTIMENTS } from "../pipeline/brandMentions";

const PAGE_SIZE = 50;
const SUMMARY_DAYS = 7;

const QuerySchema = z.object({
  category: z.enum([...MENTION_CATEGORIES, "unlabelled"]).optional(),
  sentiment: z.enum(MENTION_SENTIMENTS).optional(),
  platform: z.string().max(20).optional(),
  cursor: z.string().max(40).optional(),
});

// The mentions feed (pipeline/brandMentions.ts): non-threat social posts naming the brand,
// newest first, with a last-7-days breakdown for the summary strip.
export async function mentionRoutes(app: FastifyInstance) {
  app.get("/api/brands/:id/mentions", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const { category, sentiment, platform, cursor } = parsed.data;

    const result = await withTenant(request.auth!.orgId, async (tx) => {
      const brand = await tx.brand.findUnique({ where: { id }, select: { id: true } });
      if (!brand) return null;

      const where = {
        brandId: id,
        ...(category === "unlabelled" ? { category: null } : category ? { category } : {}),
        ...(sentiment ? { sentiment } : {}),
        ...(platform ? { platform } : {}),
      };
      const rows = await tx.brandMention.findMany({
        where,
        orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const since = new Date(Date.now() - SUMMARY_DAYS * 24 * 60 * 60 * 1000);
      const recent = await tx.brandMention.groupBy({
        by: ["category", "sentiment"],
        where: { brandId: id, firstSeenAt: { gte: since } },
        _count: { _all: true },
      });
      const byCategory: Record<string, number> = {};
      const bySentiment: Record<string, number> = {};
      let total = 0;
      for (const g of recent) {
        const n = g._count._all;
        total += n;
        byCategory[g.category ?? "unlabelled"] = (byCategory[g.category ?? "unlabelled"] ?? 0) + n;
        bySentiment[g.sentiment ?? "unlabelled"] = (bySentiment[g.sentiment ?? "unlabelled"] ?? 0) + n;
      }
      return { rows, summary: { days: SUMMARY_DAYS, total, byCategory, bySentiment } };
    });
    if (!result) return reply.status(404).send({ error: "not_found" });

    const hasMore = result.rows.length > PAGE_SIZE;
    const mentions = result.rows.slice(0, PAGE_SIZE);
    return reply.send({ mentions, nextCursor: hasMore ? mentions[mentions.length - 1].id : null, summary: result.summary });
  });
}
