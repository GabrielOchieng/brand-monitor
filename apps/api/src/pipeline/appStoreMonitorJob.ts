import { withTenant } from "../lib/tenant";
import { queryAppStore } from "../lib/appStoreSearch";

export interface AppStoreMonitorJobData {
  brandId: string;
  organizationId: string;
}

// Complementary to ctMonitorJob.ts's domain-side coverage -- searches Apple's App Store
// for apps whose title/seller name contains the brand but isn't the known official
// publisher. No Google Play equivalent: Google has no official public search-by-keyword
// API, only unofficial scraping (ToS-risky, not worth building against).
export async function runAppStoreMonitorJob(data: AppStoreMonitorJobData): Promise<void> {
  const { brandId, organizationId } = data;

  const brand = await withTenant(organizationId, (tx) => tx.brand.findUniqueOrThrow({ where: { id: brandId } }));
  const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();

  const results = await queryAppStore(brandRoot);
  if (results === null) return; // App Store search unreachable this round -- next scheduled tick retries

  for (const app of results) {
    // Apple's search is fuzzy, not literal -- only a real substring match in the app's own
    // title or seller name counts as a candidate impersonation.
    const matches = app.trackName.toLowerCase().includes(brandRoot) || app.sellerName.toLowerCase().includes(brandRoot);
    if (!matches) continue;

    // Deliberately no "is this the brand's own official app" exclusion in v1 -- unlike
    // domains (which have BrandDomain rows to check against), there's no existing
    // per-brand "known legitimate app" concept. If a brand ever publishes its own real
    // app, the first time it's flagged an analyst does one manual false_positive/resolved
    // dismissal -- the unique constraint below then keeps it from ever being recreated,
    // and the recheck dispatcher's existing status filter stops rechecking it.
    await withTenant(organizationId, async (tx) => {
      const existing = await tx.finding.findUnique({
        where: { brandId_identifier: { brandId, identifier: app.trackViewUrl } },
      });
      if (existing) return;

      await tx.finding.create({
        data: {
          brandId,
          identifier: app.trackViewUrl,
          type: "url",
          source: "app_store",
          riskScore: 0,
          severity: "low",
          nextScanAt: new Date(),
        },
      });
    });
  }
}
