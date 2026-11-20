import { withTenant } from "../lib/tenant";
import { queryAppStore } from "../lib/appStoreSearch";
import { queryGooglePlay } from "../lib/googlePlaySearch";
import { googlePlayUrl, isOfficialApp } from "../lib/appListings";
import { markSourceSuccess } from "../queue/health";
import { nameResemblesBrand } from "./socialFindings";

export interface AppStoreMonitorJobData {
  brandId: string;
  organizationId: string;
}

// Complementary to the domain-side sources: searches Apple's App Store and Google Play
// for apps whose title or publisher looks like the brand and that aren't on the brand's
// official accounts list (app links are accepted there, lib/appListings.ts). Google Play
// has no official search API; lib/googlePlaySearch.ts scrapes it, accepted 2026-11-20
// because Kenya is overwhelmingly Android.

export interface StoreApp {
  store: "app_store" | "google_play";
  appId: string;
  title: string;
  publisher: string;
  url: string;
}

// Both stores' search is relevance-ranked, not literal -- "jambojet" returns dozens of
// unrelated travel apps -- so only a name that itself resembles the brand counts. Same
// matcher as social handles: catches "Jambo Jet" and digit look-alikes too.
export function impersonatingApps(apps: StoreApp[], brandRoot: string, officialUrls: string[]): StoreApp[] {
  return apps.filter(
    (a) =>
      (nameResemblesBrand(a.title, brandRoot) || nameResemblesBrand(a.publisher, brandRoot)) &&
      !isOfficialApp(officialUrls, a.store, a.appId)
  );
}

export async function runAppStoreMonitorJob(data: AppStoreMonitorJobData): Promise<void> {
  const { brandId, organizationId } = data;

  const brand = await withTenant(organizationId, (tx) => tx.brand.findUniqueOrThrow({ where: { id: brandId } }));
  const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();

  const apps: StoreApp[] = [];
  // App Store search unreachable this round -> skipped; the next scheduled tick retries.
  const ios = await queryAppStore(brandRoot);
  for (const a of ios ?? []) {
    apps.push({ store: "app_store", appId: String(a.trackId), title: a.trackName, publisher: a.sellerName, url: a.trackViewUrl });
  }
  const play = await queryGooglePlay(brandRoot);
  if (play) {
    markSourceSuccess("google_play");
    for (const a of play) apps.push({ store: "google_play", appId: a.appId, title: a.title, publisher: a.developer, url: googlePlayUrl(a.appId) });
  }

  for (const app of impersonatingApps(apps, brandRoot, brand.officialSocialUrls)) {
    await withTenant(organizationId, async (tx) => {
      // The unique (brandId, identifier) keeps a dismissed app from being recreated.
      const existing = await tx.finding.findUnique({ where: { brandId_identifier: { brandId, identifier: app.url } } });
      if (existing) return;

      await tx.finding.create({
        data: {
          brandId,
          identifier: app.url,
          type: "url",
          source: app.store,
          riskScore: 0,
          severity: "low",
          nextScanAt: new Date(),
        },
      });
    });
  }
}
