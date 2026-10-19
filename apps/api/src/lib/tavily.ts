import { env } from "../env";
import { adminPrisma } from "../adminDb";

// Tavily web search (https://docs.tavily.com) -- the discovery source for social accounts
// and fact-checks (pipeline/socialSearchMonitorJob.ts). Picked 2026-10-19 because it's
// the only search API checked that is still free with no card: 1,000 credits a month, a
// basic search costs 1. Google's Custom Search JSON API is closed to new customers, Bing's
// was retired, Brave's free tier now needs a card. Each response is a few KB of JSON.
//
// Every call goes through the monthly counter below first, so a bug or a growing brand
// count can't run past the free allowance -- Tavily bills per credit beyond it.

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const PROVIDER = "tavily";

export interface TavilyResult {
  url: string;
  title: string | null;
  content: string | null;
}

export type TavilySearchOutcome =
  | { status: "ok"; results: TavilyResult[] }
  | { status: "budget_exhausted" }
  | { status: "error"; error: string };

export function tavilyPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

// Last count seen this process, for /health/jobs -- which an uptime monitor hits every 5
// minutes, so it reads this instead of querying the database.
let lastKnownUsage: { period: string; used: number; cap: number } | null = null;

export function tavilyUsageSnapshot() {
  return lastKnownUsage;
}

// Reserves one credit; false when this month's cap is already used up. Counted before the
// call, so a failed request still uses its slot -- erring toward under-spending.
async function reserveCredit(now: Date): Promise<boolean> {
  const rows = await adminPrisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "provider_usage" ("provider", "period", "count") VALUES (${PROVIDER}, ${tavilyPeriod(now)}, 1)
    ON CONFLICT ("provider", "period") DO UPDATE SET "count" = "provider_usage"."count" + 1
    RETURNING "count"`;
  lastKnownUsage = { period: tavilyPeriod(now), used: Math.min(rows[0].count, env.tavilyMonthlyCap), cap: env.tavilyMonthlyCap };
  return rows[0].count <= env.tavilyMonthlyCap;
}

export async function tavilySearch(
  query: string,
  options: { includeDomains: string[]; timeRange: "week" | "month"; maxResults?: number },
  now: Date = new Date()
): Promise<TavilySearchOutcome> {
  if (!(await reserveCredit(now))) return { status: "budget_exhausted" };
  try {
    const res = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.tavilyApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: options.maxResults ?? 20,
        include_domains: options.includeDomains,
        time_range: options.timeRange,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { status: "error", error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const body = (await res.json()) as { results?: Array<{ url?: string; title?: string; content?: string }> };
    const results = (body.results ?? [])
      .filter((r): r is { url: string; title?: string; content?: string } => typeof r.url === "string")
      .map((r) => ({ url: r.url, title: r.title ?? null, content: r.content ?? null }));
    return { status: "ok", results };
  } catch (err: any) {
    return { status: "error", error: String(err?.message ?? err) };
  }
}
