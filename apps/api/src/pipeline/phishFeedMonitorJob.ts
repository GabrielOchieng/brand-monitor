import { adminPrisma } from "../adminDb";
import { withTenant } from "../lib/tenant";
import { fetchPhishFeed } from "../lib/phishFeed";
import { markSourceSuccess } from "../queue/health";
import { brandMatcher } from "./nrdMonitorJob";

// Fourth finding source: URLs already reported as phishing by public feeds (lib/phishFeed.ts).
// Catches what domain-based discovery can't -- phishing on shared hosting
// (jambojet-booking.pages.dev, sites.google.com/view/jambojet-refunds), where the
// registrable domain belongs to the platform. One download serves every brand, so this
// is a single global job like nrdMonitorJob.ts.

// Turns a feed URL into a finding identity. A bare host ("https://jambojet-pay.com/") is a
// domain finding and gets the full DNS/WHOIS/favicon treatment in recheckJob.ts; anything
// with a path or query is a specific page on infrastructure we can't attribute, so it's a
// "url" finding, the same as a manually submitted social-media profile.
export function findingForFeedUrl(raw: string): { identifier: string; type: "domain" | "url" } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if ((url.pathname === "/" || url.pathname === "") && !url.search) {
    return { identifier: host.replace(/^www\./, ""), type: "domain" };
  }
  return { identifier: url.toString(), type: "url" };
}

export async function runPhishFeedMonitorJob(): Promise<void> {
  const result = await fetchPhishFeed();
  if (result.status === "error") {
    console.warn(`[phish-feed] download failed: ${result.error}`);
    return;
  }

  // Cross-tenant by nature -- same narrow id-only bypass as nrdMonitorJob.ts.
  const brands = await adminPrisma.brand.findMany({ select: { id: true, organizationId: true } });
  for (const { id: brandId, organizationId } of brands) {
    await matchBrand(brandId, organizationId, result.urls);
  }
  markSourceSuccess("phish_feed");
}

async function matchBrand(brandId: string, organizationId: string, urls: string[]): Promise<void> {
  const brand = await withTenant(organizationId, (tx) =>
    tx.brand.findUniqueOrThrow({ where: { id: brandId }, include: { domains: true } })
  );
  const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();
  const ownDomains = [brand.primaryDomain.toLowerCase(), ...brand.domains.map((d) => d.domain.toLowerCase())];
  const isOwn = (host: string) => ownDomains.some((o) => host === o || host.endsWith(`.${o}`));
  // Matched against the whole URL, not just the host: on shared hosting the brand is
  // often only in the path.
  const matches = brandMatcher(brandRoot);

  for (const raw of urls) {
    if (!matches(raw.toLowerCase())) continue;
    const target = findingForFeedUrl(raw);
    if (!target || isOwn(new URL(raw).hostname.toLowerCase())) continue;

    await withTenant(organizationId, async (tx) => {
      const existing = await tx.finding.findUnique({ where: { brandId_identifier: { brandId, identifier: target.identifier } } });
      if (existing) return;
      // Scored on the first recheck (nextScanAt now) -- source "phish_feed" carries the
      // PHISH_FEED_LISTED credit in scoring.ts.
      await tx.finding.create({
        data: { brandId, identifier: target.identifier, type: target.type, source: "phish_feed", riskScore: 0, severity: "low", nextScanAt: new Date() },
      });
    });
  }
}
