import type { Prisma } from "@prisma/client";
import { adminPrisma } from "../adminDb";

// The one place that decides which brands get monitored. A platform admin can pause a brand or
// its whole organization (routes/admin.ts); a paused brand gets no discovery, rechecks, feed
// matching (CT, NRD, phishing), app-store or social/web searches, and its data is kept.
// Every job that loops over brands must go through listMonitoredBrands(), so a new job can't
// forget the pause.

export const MONITORED_BRAND: Prisma.BrandWhereInput = {
  monitoringPausedAt: null,
  organization: { monitoringPausedAt: null },
};

// Cross-tenant by nature, id-only -- same narrow adminPrisma use as the dispatchers.
export async function listMonitoredBrands(): Promise<Array<{ id: string; organizationId: string }>> {
  return adminPrisma.brand.findMany({ where: MONITORED_BRAND, select: { id: true, organizationId: true } });
}

// Checked again when a queued job runs: it may have been queued just before the pause.
export async function isBrandPaused(brandId: string): Promise<boolean> {
  const brand = await adminPrisma.brand.findUnique({
    where: { id: brandId },
    select: { monitoringPausedAt: true, organization: { select: { monitoringPausedAt: true } } },
  });
  return !brand || !!brand.monitoringPausedAt || !!brand.organization.monitoringPausedAt;
}

export async function isFindingPaused(findingId: string): Promise<boolean> {
  const finding = await adminPrisma.finding.findUnique({ where: { id: findingId }, select: { brandId: true } });
  return !finding || isBrandPaused(finding.brandId);
}

// For request handlers, inside their withTenant transaction (RLS lets a tenant read its own
// brand and organization rows).
export async function brandPausedInTx(tx: Prisma.TransactionClient, brandId: string): Promise<boolean> {
  const brand = await tx.brand.findUnique({
    where: { id: brandId },
    select: { monitoringPausedAt: true, organization: { select: { monitoringPausedAt: true } } },
  });
  return !!brand && (!!brand.monitoringPausedAt || !!brand.organization.monitoringPausedAt);
}
