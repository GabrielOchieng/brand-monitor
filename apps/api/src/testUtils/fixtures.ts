import { randomUUID } from "node:crypto";
import { adminPrisma } from "../adminDb";

// Organization.id/User.id are externally-supplied Clerk-style ids (org_.../user_...),
// NOT @default(cuid()) -- confirmed in schema.prisma. Hardcoding a fixed test id would
// collide under Vitest's parallel test-file execution against the same shared Postgres
// container; every test-created org/user must generate its own unique id.
export function testOrgId(): string {
  return `org_test_${randomUUID()}`;
}

export function testUserId(): string {
  return `user_test_${randomUUID()}`;
}

export interface TestOrgAndBrand {
  orgId: string;
  brandId: string;
}

// Mirrors the exact adminPrisma-based fixture pattern this project's manual verification
// scripts have used for every feature this session (e.g. campaign correlation, threat-feed
// bulk actions) -- bypassing RLS to set up cross-tenant state directly, the same way the
// Clerk webhook sync and queue dispatchers legitimately do in production code.
export async function createTestOrgAndBrand(name = "Test Brand"): Promise<TestOrgAndBrand> {
  const orgId = testOrgId();
  await adminPrisma.organization.create({ data: { id: orgId, name: `Test Org ${orgId}` } });
  const brand = await adminPrisma.brand.create({
    data: { organizationId: orgId, name, primaryDomain: "example.test" },
  });
  return { orgId, brandId: brand.id };
}

export async function cleanupTestOrg(orgId: string): Promise<void> {
  const brands = await adminPrisma.brand.findMany({ where: { organizationId: orgId }, select: { id: true } });
  const brandIds = brands.map((b) => b.id);
  if (brandIds.length > 0) {
    await adminPrisma.finding.deleteMany({ where: { brandId: { in: brandIds } } });
    await adminPrisma.brand.deleteMany({ where: { id: { in: brandIds } } });
  }
  await adminPrisma.membership.deleteMany({ where: { organizationId: orgId } });
  await adminPrisma.organization.delete({ where: { id: orgId } });
}
