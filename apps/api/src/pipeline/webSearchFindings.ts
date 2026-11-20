import type { Prisma } from "@prisma/client";
import { extractIndicators, withoutOwnIndicators, type Indicator } from "../lib/indicators";
import { asksRecruitmentFee } from "../lib/recruitmentScam";
import { socialPlatformForHost } from "../lib/socialUrls";
import { findingForFeedUrl } from "./phishFeedMonitorJob";
import { brandMatcher } from "./nrdMonitorJob";
import { nameResemblesBrand, type SearchResultLike } from "./socialFindings";

// General-web searches (ROADMAP.md Phase 1), run with the social searches in
// socialSearchMonitorJob.ts. They look for the scam *content* rather than lookalike names:
// fake customer-care numbers, recruitment-fee scams and booking pitches.
//
// A live test (2026-11-20) showed most non-social hits are legitimate travel, job and news
// sites (Kayak, Skyscanner, FlightAware, MyJobMag, Capital FM). Scanning every site that
// names the brand would bury the threat feed, and an allowlist of legitimate sites never
// ends. So a result only becomes a finding when the search result itself shows a reason:
// a contact or payment number that isn't the brand's, a site name like the brand's, or a
// recruitment-fee pitch. The scan and score then decide how serious it is. A clone on an
// unrelated name whose result shows none of these is still missed.

export type WebQuery = { query: string; kind: "web" };

// Customer care and recruitment daily; the booking pitch alternates between two wordings,
// one a day. Three credits a day per brand.
export function webQueries(brandName: string, now: Date = new Date()): WebQuery[] {
  const booking = [`"${brandName}" book flights cheap tickets`, `"${brandName}" offer tickets whatsapp`];
  const day = Math.floor(now.getTime() / 86_400_000);
  return [
    { query: `"${brandName} customer care number"`, kind: "web" },
    { query: `${brandName} recruitment cabin crew jobs`, kind: "web" },
    { query: booking[day % booking.length], kind: "web" },
  ];
}

// Free website builders and hosting where the brand name sits in the subdomain
// (jambojet-booking.vercel.app) or in the path (sites.google.com/view/jambojet-refunds).
const PATH_NAMED_HOSTS = new Set(["sites.google.com", "linktr.ee", "beacons.ai", "bio.link"]);
const PATH_NAMED_SUFFIXES = [".wixsite.com", ".weebly.com", ".webflow.io", ".godaddysites.com", ".square.site"];

function sitePathName(url: URL): string {
  const host = url.hostname.toLowerCase();
  if (PATH_NAMED_HOSTS.has(host) || PATH_NAMED_SUFFIXES.some((s) => host.endsWith(s))) {
    return url.pathname.split("/").filter(Boolean).slice(0, 2).join(" ");
  }
  return "";
}

// The site's own name: the hostname without "www" and the TLD, plus the site name in the
// path on free website builders.
export function siteNameResemblesBrand(raw: string, brandRoot: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const labels = url.hostname.toLowerCase().replace(/^www\./, "").split(".");
  const names = [...labels.slice(0, -1), ...sitePathName(url).split(" ")].filter(Boolean);
  return names.some((n) => nameResemblesBrand(n, brandRoot));
}

export interface WebCandidate {
  identifier: string;
  type: "domain" | "url";
  reasons: Array<"contact_details" | "site_name" | "recruitment_fee">;
  indicators: Indicator[];
}

export function classifyWebResult(
  result: SearchResultLike,
  brand: { brandRoot: string; ownKeys: ReadonlySet<string>; ownDomains: string[] }
): WebCandidate | null {
  let url: URL;
  try {
    url = new URL(result.url);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  // Social hits go through socialFindings.ts instead.
  if (socialPlatformForHost(host)) return null;
  if (brand.ownDomains.some((d) => host === d || host.endsWith(`.${d}`))) return null;

  const text = `${result.title ?? ""}\n${result.content ?? ""}`;
  if (!brandMatcher(brand.brandRoot)(text.toLowerCase().replace(/[\s._-]+/g, ""))) return null;

  const indicators = withoutOwnIndicators(extractIndicators(text), brand.ownKeys, brand.ownDomains);
  const reasons: WebCandidate["reasons"] = [];
  if (indicators.length > 0) reasons.push("contact_details");
  if (siteNameResemblesBrand(result.url, brand.brandRoot)) reasons.push("site_name");
  if (asksRecruitmentFee(text, brand.brandRoot)) reasons.push("recruitment_fee");
  if (reasons.length === 0) return null;

  const target = findingForFeedUrl(result.url);
  if (!target) return null;
  return { ...target, reasons, indicators };
}

// Creates the finding, scanned and scored on the next recheck (nextScanAt now) like every
// other source. Skipped when the brand already tracks it, or tracks the whole site as a
// domain finding (whose scan covers the same operation). True when a finding was created.
export async function recordWebFinding(tx: Prisma.TransactionClient, brandId: string, candidate: WebCandidate): Promise<boolean> {
  const identifiers = [candidate.identifier];
  if (candidate.type === "url") identifiers.push(new URL(candidate.identifier).hostname.toLowerCase().replace(/^www\./, ""));
  const existing = await tx.finding.findFirst({ where: { brandId, identifier: { in: identifiers } }, select: { id: true } });
  if (existing) return false;
  await tx.finding.create({
    data: {
      brandId,
      identifier: candidate.identifier,
      type: candidate.type,
      source: "web_search",
      riskScore: 0,
      severity: "low",
      nextScanAt: new Date(),
    },
  });
  return true;
}
