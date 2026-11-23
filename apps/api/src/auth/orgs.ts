import { adminPrisma } from "../adminDb";
import { newId } from "./crypto";

// Default alerting so a new org isn't silently unmonitored. Orgs that existed before
// alert_rules shipped were backfilled in that migration, not here.
export async function createDefaultAlertRules(orgId: string): Promise<void> {
  const rules: Array<{ id: string; kind: string; config: object; channels: string[] }> = [
    { id: `default-severity-high-${orgId}`, kind: "severity_threshold", config: { minSeverity: "high" }, channels: ["email", "in_app"] },
    { id: `default-website-activated-${orgId}`, kind: "website_activated", config: {}, channels: ["email", "in_app"] },
    { id: `default-registration-changed-${orgId}`, kind: "registration_changed", config: {}, channels: ["email", "in_app"] },
    { id: `default-site-reactivated-${orgId}`, kind: "site_reactivated", config: {}, channels: ["email", "in_app"] },
    // In-app only -- see routes/publicReports.ts.
    { id: `default-public-report-${orgId}`, kind: "public_report", config: {}, channels: ["in_app"] },
  ];
  for (const r of rules) {
    await adminPrisma.alertRule.upsert({
      where: { id: r.id },
      create: { id: r.id, organizationId: orgId, kind: r.kind, config: r.config, channels: r.channels },
      update: {},
    });
  }
}

// adminPrisma because the org row has to exist before any tenant context can point at it.
// With ownerUserId, that user becomes its owner (the CLI script); without, it starts empty
// and the platform admin invites its first owner (the admin panel).
export async function createOrganization(name: string, ownerUserId?: string): Promise<{ id: string; name: string }> {
  const id = newId("org");
  const org = await adminPrisma.$transaction(async (tx) => {
    const created = await tx.organization.create({ data: { id, name } });
    if (ownerUserId) await tx.membership.create({ data: { userId: ownerUserId, organizationId: id, role: "owner" } });
    return created;
  });
  await createDefaultAlertRules(id);
  return { id: org.id, name: org.name };
}
