import "../testUtils/setupIntegration";
import { describe, it, expect, afterAll } from "vitest";
import { adminPrisma } from "../adminDb";
import { withTenant } from "./tenant";
import { createTestOrgAndBrand, cleanupTestOrg, type TestOrgAndBrand } from "../testUtils/fixtures";

const createdOrgs: TestOrgAndBrand[] = [];

async function makeOrg(name: string): Promise<TestOrgAndBrand> {
  const org = await createTestOrgAndBrand(name);
  createdOrgs.push(org);
  return org;
}

afterAll(async () => {
  for (const org of createdOrgs) {
    await cleanupTestOrg(org.orgId);
  }
});

describe("withTenant / RLS tenant isolation", () => {
  it("does not let org A read org B's findings", async () => {
    const orgA = await makeOrg("Org A");
    const orgB = await makeOrg("Org B");

    await adminPrisma.finding.create({
      data: { brandId: orgB.brandId, type: "domain", identifier: "orgb-only.example.test", source: "manual_submission" },
    });

    const visibleToA = await withTenant(orgA.orgId, (tx) =>
      tx.finding.findMany({ where: { identifier: "orgb-only.example.test" } })
    );
    expect(visibleToA).toHaveLength(0);

    const visibleToB = await withTenant(orgB.orgId, (tx) =>
      tx.finding.findMany({ where: { identifier: "orgb-only.example.test" } })
    );
    expect(visibleToB).toHaveLength(1);
  });

  it("rejects a write attempting to insert a row under a brand outside the current tenant context", async () => {
    // The RLS policies are USING-only, no explicit WITH CHECK -- Postgres reuses USING
    // as the check for INSERT/UPDATE too. Attempting to create a Finding under org A's
    // brand while app.current_org_id is set to org B should be rejected, not silently
    // succeed under the wrong tenant. This is a previously-untested half of what these
    // policies are supposed to guarantee (prior manual verification only ever checked
    // the read-filtering direction).
    const orgA = await makeOrg("Org A (write-check)");
    const orgB = await makeOrg("Org B (write-check)");

    await expect(
      withTenant(orgB.orgId, (tx) =>
        tx.finding.create({
          data: { brandId: orgA.brandId, type: "domain", identifier: "cross-tenant-write.example.test", source: "manual_submission" },
        })
      )
    ).rejects.toThrow();

    const leaked = await adminPrisma.finding.findMany({ where: { identifier: "cross-tenant-write.example.test" } });
    expect(leaked).toHaveLength(0);
  });

  it("bulk-PATCH semantics: updateMany against a mixed batch of real + cross-tenant ids only updates the real ones", async () => {
    // Regression test for apps/api/src/routes/findings.ts's PATCH /api/findings/bulk,
    // manually verified by hand during the threat-feed filtering/bulk-actions feature --
    // codifying it here so a future change can't silently regress it.
    const orgA = await makeOrg("Org A (bulk)");
    const orgB = await makeOrg("Org B (bulk)");

    const ownFindings = await Promise.all(
      ["bulk-a1.example.test", "bulk-a2.example.test"].map((identifier) =>
        adminPrisma.finding.create({ data: { brandId: orgA.brandId, type: "domain", identifier, source: "manual_submission" } })
      )
    );
    const foreignFinding = await adminPrisma.finding.create({
      data: { brandId: orgB.brandId, type: "domain", identifier: "bulk-foreign.example.test", source: "manual_submission" },
    });

    const idsRequested = [...ownFindings.map((f) => f.id), foreignFinding.id];
    const result = await withTenant(orgA.orgId, (tx) =>
      tx.finding.updateMany({ where: { id: { in: idsRequested } }, data: { status: "investigating" } })
    );

    expect(result.count).toBe(2); // only the two real org-A findings, not the foreign one
    expect(idsRequested).toHaveLength(3);

    const foreignAfter = await adminPrisma.finding.findUnique({ where: { id: foreignFinding.id } });
    expect(foreignAfter?.status).toBe("new"); // untouched, still its default status
  });
});
