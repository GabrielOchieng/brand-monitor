import { adminPrisma } from "../adminDb";
import { env } from "../env";
import { withTenant } from "../lib/tenant";
import { tavilySearch, type TavilyResult } from "../lib/tavily";
import { SOCIAL_SEARCH_DOMAINS } from "../lib/socialUrls";
import { markSourceSuccess } from "../queue/health";
import { classifySocialResult, recordSocialSighting, socialOwnIndicatorKeys } from "./socialFindings";
import { brandMatcher } from "./nrdMonitorJob";

// Fifth finding source: fake social-media accounts, found through a web search engine
// (lib/tavily.ts) because no platform offers a free API that searches other people's
// accounts (X is pay-per-use since Feb 2026, Meta's page search needs business
// verification + app review, TikTok's is academic-only). Search engines do index these
// fakes: the 2026-10-19 manual sweep turned up tiktok.com/@fly.jambojet, whose video title
// carried its WhatsApp number. Daily, three searches per brand, ~90 of the 1,000 free
// monthly credits per brand.
//
// Also a weekly fact-check search: PesaCheck (Kenya) regularly debunks fake Jambojet
// posts, and each article names the fake account. Their RSS feed only holds the last ~15
// articles (about a day), so a search is the reliable way to catch them.

const SOCIAL_DOMAINS = Object.values(SOCIAL_SEARCH_DOMAINS).flat();

export function socialQueries(brandName: string): Array<{ query: string; includeDomains: string[] }> {
  return [
    // The fake-booking pattern: cheap tickets, pay or book over WhatsApp.
    { query: `${brandName} tickets booking offer whatsapp`, includeDomains: SOCIAL_DOMAINS },
    { query: brandName, includeDomains: [...SOCIAL_SEARCH_DOMAINS.tiktok, ...SOCIAL_SEARCH_DOMAINS.instagram] },
    { query: brandName, includeDomains: [...SOCIAL_SEARCH_DOMAINS.facebook, ...SOCIAL_SEARCH_DOMAINS.telegram, ...SOCIAL_SEARCH_DOMAINS.x] },
  ];
}

export const FACT_CHECK_DOMAINS = ["pesacheck.org"];

async function listBrands() {
  // Cross-tenant by nature -- same narrow id-only bypass as nrdMonitorJob.ts.
  return adminPrisma.brand.findMany({ select: { id: true, organizationId: true } });
}

export async function runSocialSearchMonitorJob(): Promise<void> {
  if (!env.tavilyApiKey) return;
  let anySucceeded = false;

  for (const { id: brandId, organizationId } of await listBrands()) {
    const brand = await withTenant(organizationId, (tx) =>
      tx.brand.findUniqueOrThrow({ where: { id: brandId }, include: { domains: true } })
    );
    const context = {
      brandRoot: brand.primaryDomain.split(".")[0].toLowerCase(),
      officialSocialUrls: brand.officialSocialUrls,
      ownKeys: await socialOwnIndicatorKeys(organizationId, brand),
      ownDomains: [brand.primaryDomain, ...brand.domains.map((d) => d.domain)].map((d) => d.toLowerCase()),
    };

    let created = 0;
    for (const { query, includeDomains } of socialQueries(brand.name)) {
      const outcome = await tavilySearch(query, { includeDomains, timeRange: "month" });
      if (outcome.status === "budget_exhausted") {
        console.warn("[social-search] monthly Tavily cap reached -- skipping until next month");
        return;
      }
      if (outcome.status === "error") {
        console.warn(`[social-search] "${query}" failed: ${outcome.error}`);
        continue;
      }
      anySucceeded = true;

      for (const result of outcome.results) {
        const candidate = classifySocialResult(result, context);
        if (!candidate) continue;
        // Scored on the next recheck (nextScanAt now for anything new) -- same as every
        // other finding source.
        const outcomeForResult = await withTenant(organizationId, (tx) =>
          recordSocialSighting(tx, brandId, "social_search", {
            account: candidate.account,
            postUrl: candidate.postUrl,
            title: candidate.title,
            snippet: candidate.snippet,
            indicators: candidate.indicators,
          })
        );
        if (outcomeForResult.created) created++;
      }
    }
    if (created > 0) console.log(`[social-search] ${created} new social finding(s) for brand ${brandId}`);
  }
  if (anySucceeded) markSourceSuccess("social_search");
}

// A fact-check article about the brand becomes an in-app notification linking to it, not a
// finding: the article isn't the threat, and the account it describes is often already
// gone. The analyst submits whatever is still live.
export function isFactCheckAboutBrand(result: TavilyResult, brandRoot: string): boolean {
  if (!FACT_CHECK_DOMAINS.some((d) => new URL(result.url).hostname.replace(/^www\./, "") === d)) return false;
  const text = `${result.title ?? ""} ${result.content ?? ""}`.toLowerCase().replace(/[\s._-]+/g, "");
  return brandMatcher(brandRoot)(text);
}

export async function runFactCheckMonitorJob(): Promise<void> {
  if (!env.tavilyApiKey) return;

  for (const { id: brandId, organizationId } of await listBrands()) {
    const brand = await withTenant(organizationId, (tx) => tx.brand.findUniqueOrThrow({ where: { id: brandId } }));
    const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();
    const outcome = await tavilySearch(brand.name, { includeDomains: FACT_CHECK_DOMAINS, timeRange: "month" });
    if (outcome.status === "budget_exhausted") return;
    if (outcome.status === "error") {
      console.warn(`[fact-check] search for brand ${brandId} failed: ${outcome.error}`);
      continue;
    }

    for (const result of outcome.results) {
      if (!isFactCheckAboutBrand(result, brandRoot)) continue;
      await withTenant(organizationId, async (tx) => {
        const seen = await tx.notification.findFirst({ where: { organizationId, link: result.url } });
        if (seen) return;
        await tx.notification.create({
          data: {
            organizationId,
            link: result.url,
            message: `Fact-check published about ${brand.name}: ${(result.title ?? result.url).slice(0, 160)}`,
          },
        });
      });
    }
  }
}
