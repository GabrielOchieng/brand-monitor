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
// carried its WhatsApp number. Daily, per brand: four brand searches (one in Swahili) plus
// up to NUMBER_PIVOTS_PER_DAY searches by contact numbers already found on the brand's
// findings -- about 186 of the 1,000 free monthly credits per brand, so the 900-credit cap
// (TAVILY_MONTHLY_CAP) covers about four brands before the guard stops searches for the
// rest of the month.
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
    // The same pitch in Swahili: tiketi (tickets), ofa (offer), bei nafuu (cheap).
    { query: `${brandName} tiketi ofa bei nafuu whatsapp`, includeDomains: SOCIAL_DOMAINS },
  ];
}

export const NUMBER_PIVOTS_PER_DAY = 2;

// A scam number found on one finding usually also appears on the operator's other pages.
// Searching by it finds fakes that never name the brand in a way a search for the brand
// would rank. Rotates through the brand's numbers, NUMBER_PIVOTS_PER_DAY a day.
export function numberPivotQueries(numbers: string[], now: Date = new Date()): Array<{ number: string; query: string }> {
  const sorted = [...new Set(numbers)].sort();
  if (sorted.length === 0) return [];
  const day = Math.floor(now.getTime() / 86_400_000);
  const count = Math.min(NUMBER_PIVOTS_PER_DAY, sorted.length);
  const start = (day * NUMBER_PIVOTS_PER_DAY) % sorted.length;
  return Array.from({ length: count }, (_, k) => {
    const number = sorted[(start + k) % sorted.length];
    // Kenyan numbers are written locally (0710 492 539) at least as often as +254.
    const local = /^\+254\d{9}$/.test(number) ? ` OR "0${number.slice(4)}"` : "";
    return { number, query: `"${number}"${local}` };
  });
}

// Phone/WhatsApp numbers on the brand's high/critical findings that aren't the brand's own,
// skipping findings an analyst marked as false positives. Lower-scored findings include
// travel agents and creators quoting their own numbers; pivoting on those spreads noise
// (seen live 2026-11-20: a medium-confidence TikTok's number led to a bus company's page).
async function brandPivotNumbers(organizationId: string, brandId: string, ownKeys: ReadonlySet<string>): Promise<string[]> {
  const rows = await withTenant(organizationId, (tx) =>
    tx.findingIndicator.findMany({
      where: {
        brandId,
        kind: { in: ["phone", "whatsapp"] },
        finding: { status: { not: "false_positive" }, severity: { in: ["high", "critical"] } },
      },
      select: { value: true },
      distinct: ["value"],
    })
  );
  return rows.map((r) => r.value).filter((v) => !ownKeys.has(`phone:${v}`) && !ownKeys.has(`whatsapp:${v}`));
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

    const searches: Array<{ query: string; includeDomains: string[]; pivot?: ReadonlySet<string> }> = [
      ...socialQueries(brand.name),
      ...numberPivotQueries(await brandPivotNumbers(organizationId, brandId, context.ownKeys)).map((p) => ({
        query: p.query,
        includeDomains: SOCIAL_DOMAINS,
        pivot: new Set([p.number]) as ReadonlySet<string>,
      })),
    ];

    let created = 0;
    for (const { query, includeDomains, pivot } of searches) {
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
        const candidate = classifySocialResult(result, context, pivot);
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
