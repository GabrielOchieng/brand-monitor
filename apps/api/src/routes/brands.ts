import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../lib/auth";
import { withTenant } from "../lib/tenant";

const CreateBrandSchema = z.object({
  name: z.string().min(1),
  primaryDomain: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  concatKeywords: z.array(z.string()).default([]),
});

// Minimal brand CRUD -- enough to onboard a brand per org and prove tenant isolation.
// The full onboarding UI (domains/assets management, editing) is Stage B.
export async function brandRoutes(app: FastifyInstance) {
  app.get("/api/brands", { preHandler: authenticate }, async (request, reply) => {
    const brands = await withTenant(request.auth!.orgId, (tx) =>
      tx.brand.findMany({ orderBy: { createdAt: "asc" } })
    );
    return reply.send(brands);
  });

  app.post(
    "/api/brands",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const parsed = CreateBrandSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const { name, primaryDomain, keywords, concatKeywords } = parsed.data;
      const orgId = request.auth!.orgId;

      const brand = await withTenant(orgId, async (tx) => {
        const created = await tx.brand.create({
          data: { organizationId: orgId, name, primaryDomain },
        });
        await tx.brandDomain.create({ data: { brandId: created.id, domain: primaryDomain, type: "primary" } });
        for (const keyword of keywords) {
          await tx.brandKeyword.create({ data: { brandId: created.id, keyword, type: "name" } });
        }
        for (const keyword of concatKeywords) {
          await tx.brandKeyword.create({ data: { brandId: created.id, keyword, type: "concat_term" } });
        }
        return created;
      });

      return reply.status(201).send(brand);
    }
  );
}
