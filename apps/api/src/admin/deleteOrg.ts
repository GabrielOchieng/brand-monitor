import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { adminPrisma } from "../adminDb";

export interface DeleteOrgResult {
  name: string;
  brands: number;
  findings: number;
  scans: number;
  deletedUsers: string[];
}

// Deletes an organization and everything under it, in one transaction, child tables first
// (every foreign key is RESTRICT). Same statements as the SQL script used on production
// 2026-11-23. Members whose only organization this is are deleted too, except platform
// admins (they only lose the membership). Screenshot files go after the commit, best effort.
// Alert deliveries and notifications go too: unlike deleting one brand, nothing of the org is
// left to keep a history for.
export async function deleteOrganization(orgId: string, record: (tx: Prisma.TransactionClient, r: DeleteOrgResult) => Promise<void>): Promise<DeleteOrgResult | null> {
  const result = await adminPrisma.$transaction(
    async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: orgId } });
      if (!org) return null;

      await tx.$executeRaw`CREATE TEMP TABLE d_brands ON COMMIT DROP AS SELECT id FROM brands WHERE organization_id = ${orgId}`;
      await tx.$executeRaw`CREATE TEMP TABLE d_findings ON COMMIT DROP AS SELECT id FROM findings WHERE brand_id IN (SELECT id FROM d_brands)`;
      await tx.$executeRaw`CREATE TEMP TABLE d_scans ON COMMIT DROP AS SELECT id FROM scans WHERE finding_id IN (SELECT id FROM d_findings)`;
      await tx.$executeRaw`
        CREATE TEMP TABLE d_users ON COMMIT DROP AS
        SELECT u.id, u.email FROM users u
        WHERE u.platform_role IS NULL
          AND u.id IN (SELECT user_id FROM memberships WHERE organization_id = ${orgId})
          AND u.id NOT IN (SELECT user_id FROM memberships WHERE organization_id <> ${orgId})`;

      const [counts] = await tx.$queryRaw<Array<{ brands: bigint; findings: bigint; scans: bigint }>>`
        SELECT (SELECT count(*) FROM d_brands) AS brands, (SELECT count(*) FROM d_findings) AS findings, (SELECT count(*) FROM d_scans) AS scans`;
      const users = await tx.$queryRaw<Array<{ email: string }>>`SELECT email FROM d_users ORDER BY email`;
      const findingIds = (await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM d_findings`).map((r) => r.id);
      const brandIds = (await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM d_brands`).map((r) => r.id);

      const statements: Prisma.Sql[] = [
        Prisma.sql`DELETE FROM ai_explanations      WHERE finding_id IN (SELECT id FROM d_findings) OR scan_id IN (SELECT id FROM d_scans)`,
        Prisma.sql`DELETE FROM alert_deliveries     WHERE finding_id IN (SELECT id FROM d_findings) OR scan_id IN (SELECT id FROM d_scans)`,
        Prisma.sql`DELETE FROM finding_changes      WHERE finding_id IN (SELECT id FROM d_findings) OR scan_id IN (SELECT id FROM d_scans)`,
        Prisma.sql`DELETE FROM finding_evidence     WHERE finding_id IN (SELECT id FROM d_findings) OR scan_id IN (SELECT id FROM d_scans)`,
        Prisma.sql`DELETE FROM finding_score_events WHERE finding_id IN (SELECT id FROM d_findings) OR scan_id IN (SELECT id FROM d_scans)`,
        Prisma.sql`DELETE FROM notifications        WHERE organization_id = ${orgId} OR finding_id IN (SELECT id FROM d_findings) OR scan_id IN (SELECT id FROM d_scans)`,
        Prisma.sql`DELETE FROM finding_indicators   WHERE finding_id IN (SELECT id FROM d_findings) OR brand_id IN (SELECT id FROM d_brands)`,
        Prisma.sql`DELETE FROM social_intel         WHERE finding_id IN (SELECT id FROM d_findings) OR brand_id IN (SELECT id FROM d_brands)`,
        Prisma.sql`DELETE FROM public_reports       WHERE finding_id IN (SELECT id FROM d_findings) OR brand_id IN (SELECT id FROM d_brands)`,
        Prisma.sql`DELETE FROM domain_intel         WHERE finding_id IN (SELECT id FROM d_findings)`,
        Prisma.sql`DELETE FROM finding_notes        WHERE finding_id IN (SELECT id FROM d_findings)`,
        Prisma.sql`DELETE FROM takedown_requests    WHERE finding_id IN (SELECT id FROM d_findings)`,
        Prisma.sql`DELETE FROM website_intel        WHERE finding_id IN (SELECT id FROM d_findings)`,
        Prisma.sql`UPDATE findings SET last_scan_id = NULL WHERE id IN (SELECT id FROM d_findings)`,
        Prisma.sql`DELETE FROM scans                WHERE id IN (SELECT id FROM d_scans)`,
        Prisma.sql`DELETE FROM findings             WHERE id IN (SELECT id FROM d_findings)`,
        Prisma.sql`DELETE FROM brand_assets         WHERE brand_id IN (SELECT id FROM d_brands)`,
        Prisma.sql`DELETE FROM brand_domains        WHERE brand_id IN (SELECT id FROM d_brands)`,
        Prisma.sql`DELETE FROM brand_keywords       WHERE brand_id IN (SELECT id FROM d_brands)`,
        Prisma.sql`DELETE FROM brand_mentions       WHERE brand_id IN (SELECT id FROM d_brands)`,
        Prisma.sql`DELETE FROM pipeline_runs        WHERE brand_id IN (SELECT id FROM d_brands)`,
        Prisma.sql`DELETE FROM brand_usage          WHERE brand_id IN (SELECT id FROM d_brands)`,
        Prisma.sql`DELETE FROM brands               WHERE id IN (SELECT id FROM d_brands)`,
        Prisma.sql`DELETE FROM takedown_documents         WHERE organization_id = ${orgId}`,
        Prisma.sql`DELETE FROM takedown_authorizations    WHERE organization_id = ${orgId}`,
        Prisma.sql`DELETE FROM takedown_senders           WHERE organization_id = ${orgId}`,
        Prisma.sql`DELETE FROM takedown_automation        WHERE organization_id = ${orgId}`,
        Prisma.sql`DELETE FROM takedown_automation_events WHERE organization_id = ${orgId}`,
        Prisma.sql`DELETE FROM alert_rules          WHERE organization_id = ${orgId}`,
        Prisma.sql`DELETE FROM webhook_configs      WHERE organization_id = ${orgId}`,
        Prisma.sql`DELETE FROM auth_tokens          WHERE organization_id = ${orgId}`,
        Prisma.sql`UPDATE sessions SET active_org_id = NULL WHERE active_org_id = ${orgId}`,
        Prisma.sql`UPDATE sessions SET admin_view_org_id = NULL WHERE admin_view_org_id = ${orgId}`,
        Prisma.sql`DELETE FROM memberships          WHERE organization_id = ${orgId}`,
        Prisma.sql`DELETE FROM organizations        WHERE id = ${orgId}`,
        // Sessions and credentials cascade with the user.
        Prisma.sql`DELETE FROM auth_tokens          WHERE user_id IN (SELECT id FROM d_users)`,
        Prisma.sql`DELETE FROM users                WHERE id IN (SELECT id FROM d_users)`,
      ];
      for (const s of statements) await tx.$executeRaw(s);

      const r: DeleteOrgResult = {
        name: org.name,
        brands: Number(counts.brands),
        findings: Number(counts.findings),
        scans: Number(counts.scans),
        deletedUsers: users.map((u) => u.email),
      };
      await record(tx, r);
      return { r, findingIds, brandIds };
    },
    { timeout: 120_000 }
  );
  if (!result) return null;

  const dir = path.join(process.cwd(), "screenshots");
  const files = [...result.findingIds.map((id) => `${id}.png`), ...result.brandIds.map((id) => `brand-${id}.png`)];
  for (const f of files) {
    await fs.unlink(path.join(dir, f)).catch(() => {});
  }
  return result.r;
}

