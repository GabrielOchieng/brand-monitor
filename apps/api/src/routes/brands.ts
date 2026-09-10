import path from "node:path";
import fs from "node:fs/promises";
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

const UpdateBrandSchema = z.object({
  name: z.string().min(1).optional(),
  primaryDomain: z.string().min(1).optional(),
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

  // Name/primary-domain only -- keyword editing (name/concat_term BrandKeyword rows)
  // isn't exposed here yet, same deliberate scope cut as brand creation's minimal CRUD.
  app.patch(
    "/api/brands/:id",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = UpdateBrandSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
      const { name, primaryDomain } = parsed.data;
      const orgId = request.auth!.orgId;

      try {
        const updated = await withTenant(orgId, async (tx) => {
          const brand = await tx.brand.update({
            where: { id },
            data: { ...(name !== undefined ? { name } : {}), ...(primaryDomain !== undefined ? { primaryDomain } : {}) },
          });
          // Keep the "primary" BrandDomain row in sync -- discoveryJob.ts reads
          // brand.primaryDomain directly for candidate generation, but the allowlist
          // (and anything else keying off BrandDomain) should reflect the same domain,
          // not a stale one left over from creation.
          if (primaryDomain !== undefined) {
            const existingPrimary = await tx.brandDomain.findFirst({ where: { brandId: id, type: "primary" } });
            if (existingPrimary) {
              await tx.brandDomain.update({ where: { id: existingPrimary.id }, data: { domain: primaryDomain } });
            } else {
              await tx.brandDomain.create({ data: { brandId: id, domain: primaryDomain, type: "primary" } });
            }
          }
          return brand;
        });
        return reply.send(updated);
      } catch (err: any) {
        if (err?.code === "P2025") return reply.status(404).send({ error: "not_found" });
        throw err;
      }
    }
  );

  // Deletes a brand and everything under it -- every child table has a real FK
  // (ON DELETE RESTRICT), so Postgres refuses the delete unless children go first, in
  // dependency order (scan-tagged rows before their Scan, everything before Finding,
  // everything before Brand). Deliberately NOT touching AlertDelivery/Notification --
  // both intentionally use plain findingId/scanId strings, not real FKs (see the comment
  // on AlertDelivery in schema.prisma), specifically so a deleted finding's alert/
  // notification history survives as an orphaned-but-harmless audit trail, same
  // reasoning as an audit log that never cascades.
  app.delete(
    "/api/brands/:id",
    { preHandler: [authenticate, requireRole("owner", "admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = request.auth!.orgId;

      const result = await withTenant(orgId, async (tx) => {
        const brand = await tx.brand.findUnique({ where: { id } });
        if (!brand) return null;

        const findings = await tx.finding.findMany({ where: { brandId: id }, select: { id: true } });
        const findingIds = findings.map((f) => f.id);

        await tx.findingEvidence.deleteMany({ where: { findingId: { in: findingIds } } });
        await tx.findingScoreEvent.deleteMany({ where: { findingId: { in: findingIds } } });
        await tx.aiExplanation.deleteMany({ where: { findingId: { in: findingIds } } });
        await tx.domainIntel.deleteMany({ where: { findingId: { in: findingIds } } });
        await tx.websiteIntel.deleteMany({ where: { findingId: { in: findingIds } } });
        await tx.findingNote.deleteMany({ where: { findingId: { in: findingIds } } });
        await tx.takedown.deleteMany({ where: { findingId: { in: findingIds } } });
        // Scan last among finding-children -- FindingEvidence/FindingScoreEvent/
        // AiExplanation all also carry a scanId FK, so Scan must outlive them.
        await tx.scan.deleteMany({ where: { findingId: { in: findingIds } } });
        await tx.finding.deleteMany({ where: { brandId: id } });

        await tx.brandDomain.deleteMany({ where: { brandId: id } });
        await tx.brandKeyword.deleteMany({ where: { brandId: id } });
        await tx.brandAsset.deleteMany({ where: { brandId: id } });
        await tx.pipelineRun.deleteMany({ where: { brandId: id } });
        await tx.brand.delete({ where: { id } });

        return { findingIds };
      });

      if (!result) return reply.status(404).send({ error: "not_found" });

      // Best-effort screenshot cleanup -- runs after the transaction already committed,
      // so a failure here (e.g. a file already gone) must never fail the response; the
      // DB-level deletion is the source of truth, this is just disk hygiene.
      for (const findingId of result.findingIds) {
        try {
          await fs.unlink(path.join(process.cwd(), "screenshots", `${findingId}.png`));
        } catch {
          // no screenshot for this finding, or already gone -- fine either way
        }
      }

      return reply.status(204).send();
    }
  );
}
