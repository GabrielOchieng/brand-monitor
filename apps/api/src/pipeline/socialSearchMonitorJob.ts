import { listMonitoredBrands } from "../lib/monitoredBrands";
import { env } from "../env";
import { withTenant } from "../lib/tenant";
import { tavilySearch, type TavilyResult } from "../lib/tavily";
import { SOCIAL_SEARCH_DOMAINS } from "../lib/socialUrls";
import { markSourceSuccess } from "../queue/health";
import { classifySocialResult, recordSocialSighting, socialOwnIndicatorKeys } from "./socialFindings";
import { labelPendingMentions, mentionFromResult, recordMention } from "./brandMentions";
import { brandMatcher } from "./nrdMonitorJob";
import { classifyWebResult, recordWebFinding, webQueries } from "./webSearchFindings";

// Fifth finding source: fake social-media accounts, found through a web search engine
// (lib/tavily.ts) because no platform offers a free API that searches other people's
// accounts (X is pay-per-use since Feb 2026, Meta's page search needs business
// verification + app review, TikTok's is academic-only). Search engines do index these
// fakes: the 2026-10-19 manual sweep turned up tiktok.com/@fly.jambojet, whose video title
// carried its WhatsApp number. Daily, per brand: four brand searches (one in Swahili), up
// to NUMBER_PIVOTS_PER_DAY searches by contact numbers already found on the brand's
// findings, and three general-web searches for scam content (pipeline/webSearchFindings.ts)
// -- about 276 of the 1,000 free monthly credits per brand, so the 900-credit cap
// (TAVILY_MONTHLY_CAP) covers about three brands before the guard stops searches for the
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

// A run brings up to ~80 new mentions; 4 labelling calls of 25 cover that.
const MAX_LABEL_BATCHES_PER_RUN = 4;

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
  // Cross-tenant by nature -- same narrow id-only bypass as nrdMonitorJob.ts. Paused brands
  // (platform admin) are skipped -- lib/monitoredBrands.ts.
  return listMonitoredBrands();
}

export interface SocialSearchOutcome {
  searchesRun: number;
  newFindings: number;
  // Non-threat posts naming the brand, for the mentions feed (pipeline/brandMentions.ts).
  newMentions: number;
  budgetExhausted: boolean;
}

// One brand's searches. Shared by the daily job and the dashboard's "Search social media
// now" button (routes/pipeline.ts), which queues a job for a single brand.
export async function runSocialSearchForBrand(organizationId: string, brandId: string): Promise<SocialSearchOutcome> {
  const brand = await withTenant(organizationId, (tx) =>
    tx.brand.findUniqueOrThrow({ where: { id: brandId }, include: { domains: true } })
  );
  const context = {
    brandRoot: brand.primaryDomain.split(".")[0].toLowerCase(),
    officialSocialUrls: brand.officialSocialUrls,
    ownKeys: await socialOwnIndicatorKeys(organizationId, brand),
    ownDomains: [brand.primaryDomain, ...brand.domains.map((d) => d.domain)].map((d) => d.toLowerCase()),
  };

  const searches: Array<{ query: string; includeDomains?: string[]; excludeDomains?: string[]; pivot?: ReadonlySet<string> }> = [
    ...socialQueries(brand.name),
    ...numberPivotQueries(await brandPivotNumbers(organizationId, brandId, context.ownKeys)).map((p) => ({
      query: p.query,
      includeDomains: SOCIAL_DOMAINS,
      pivot: new Set([p.number]) as ReadonlySet<string>,
    })),
    // The whole web except the brand's own sites (pipeline/webSearchFindings.ts). Social
    // hits among the results take the same path as the social searches' hits.
    ...webQueries(brand.name).map((w) => ({ query: w.query, excludeDomains: context.ownDomains })),
  ];

  const outcome: SocialSearchOutcome = { searchesRun: 0, newFindings: 0, newMentions: 0, budgetExhausted: false };
  for (const { query, includeDomains, excludeDomains, pivot } of searches) {
    const search = await tavilySearch(query, { brandId, includeDomains, excludeDomains, timeRange: "month" });
    if (search.status === "budget_exhausted") {
      console.warn("[social-search] monthly Tavily cap reached -- skipping until next month");
      outcome.budgetExhausted = true;
      break;
    }
    if (search.status === "error") {
      console.warn(`[social-search] "${query}" failed: ${search.error}`);
      continue;
    }
    outcome.searchesRun++;

    for (const result of search.results) {
      const web = classifyWebResult(result, context);
      if (web) {
        if (await withTenant(organizationId, (tx) => recordWebFinding(tx, brandId, web))) outcome.newFindings++;
        continue;
      }
      const candidate = classifySocialResult(result, context, pivot);
      if (!candidate) {
        // Not a threat -- but if it names the brand, it belongs in the mentions feed.
        const mention = mentionFromResult(result, context);
        if (mention && (await withTenant(organizationId, (tx) => recordMention(tx, brandId, mention)))) outcome.newMentions++;
        continue;
      }
      // Scored on the next recheck (nextScanAt now for anything new) -- same as every
      // other finding source.
      const sighting = await withTenant(organizationId, async (tx) => {
        const recorded = await recordSocialSighting(tx, brandId, "social_search", {
          account: candidate.account,
          postUrl: candidate.postUrl,
          title: candidate.title,
          snippet: candidate.snippet,
          indicators: candidate.indicators,
        });
        // A post an earlier run filed as a mention (before the rules could tell it was a
        // threat) moves to the threat feed rather than showing in both.
        await tx.brandMention.deleteMany({ where: { brandId, url: candidate.postUrl } });
        return recorded;
      });
      if (sighting.created) outcome.newFindings++;
    }
  }
  // Stored mentions get the current threat rules too, from their saved title/snippet (no
  // search credits): a rule improvement then reaches posts filed as mentions before it,
  // without waiting for the search to happen to return them again.
  const stored = await withTenant(organizationId, (tx) =>
    tx.brandMention.findMany({ where: { brandId }, select: { id: true, url: true, title: true, snippet: true } })
  );
  for (const m of stored) {
    const candidate = classifySocialResult({ url: m.url, title: m.title, content: m.snippet }, context);
    if (!candidate) continue;
    const sighting = await withTenant(organizationId, async (tx) => {
      const recorded = await recordSocialSighting(tx, brandId, "social_search", {
        account: candidate.account,
        postUrl: candidate.postUrl,
        title: candidate.title,
        snippet: candidate.snippet,
        indicators: candidate.indicators,
      });
      await tx.brandMention.delete({ where: { id: m.id } });
      return recorded;
    });
    if (sighting.created) outcome.newFindings++;
  }

  if (outcome.newFindings > 0) console.log(`[social-search] ${outcome.newFindings} new social finding(s) for brand ${brandId}`);
  if (outcome.newMentions > 0) console.log(`[social-search] ${outcome.newMentions} new mention(s) for brand ${brandId}`);
  if (outcome.searchesRun > 0) markSourceSuccess("social_search");
  // Label the new (and any still-unlabelled) mentions, one AI call per batch of 25, until
  // none are left or MAX_LABEL_BATCHES_PER_RUN is reached; a failure only delays it.
  for (let i = 0; i < MAX_LABEL_BATCHES_PER_RUN; i++) {
    if ((await labelPendingMentions(organizationId, brandId, brand.name)) === 0) break;
  }
  return outcome;
}

export async function runSocialSearchMonitorJob(): Promise<void> {
  if (!env.tavilyApiKey) return;
  for (const { id: brandId, organizationId } of await listBrands()) {
    const outcome = await runSocialSearchForBrand(organizationId, brandId);
    if (outcome.budgetExhausted) return;
  }
}

export function manualSearchMessage(brandName: string, outcome: SocialSearchOutcome): string {
  if (outcome.searchesRun === 0) {
    return outcome.budgetExhausted
      ? `Search for ${brandName} didn't run: this month's search allowance is used up.`
      : `Search for ${brandName} failed: the search service didn't answer. Try again later.`;
  }
  if (outcome.newFindings > 0) {
    const n = outcome.newFindings;
    const mentions = outcome.newMentions > 0 ? ` Also ${outcome.newMentions} new mention${outcome.newMentions === 1 ? "" : "s"} in Mentions.` : "";
    return `Search for ${brandName} found ${n} new possible threat${n === 1 ? "" : "s"}. They're scored within a few minutes and appear in Threats.${mentions}`;
  }
  const mentions = outcome.newMentions > 0 ? ` ${outcome.newMentions} new mention${outcome.newMentions === 1 ? "" : "s"} added to Mentions.` : "";
  return `Search for ${brandName} finished with no new threats (${outcome.searchesRun} searches).${mentions}`;
}

// The dashboard button's job: one brand, then an in-app notification with the result so
// the person who clicked knows it finished.
export async function runManualSocialSearch(organizationId: string, brandId: string): Promise<void> {
  if (!env.tavilyApiKey) return;
  const outcome = await runSocialSearchForBrand(organizationId, brandId);
  const brand = await withTenant(organizationId, (tx) => tx.brand.findUnique({ where: { id: brandId }, select: { name: true } }));
  const message = manualSearchMessage(brand?.name ?? "this brand", outcome);
  await withTenant(organizationId, (tx) => tx.notification.create({ data: { organizationId, message } }));
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
    const outcome = await tavilySearch(brand.name, { brandId, includeDomains: FACT_CHECK_DOMAINS, timeRange: "month" });
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
