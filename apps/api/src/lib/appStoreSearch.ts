export interface AppResult {
  trackId: number;
  trackName: string;
  sellerName: string;
  trackViewUrl: string;
}

// Apple's iTunes Search API: free, public, unauthenticated, ~20 req/min per IP (confirmed
// via Apple's own developer forums, not assumed) -- trivially enough for a per-brand
// periodic check. Hardcoded to the US storefront -- Apple's catalog search is reasonably
// global even filtered by storefront, and per-brand country configuration is real extra
// scope not needed yet.
//
// `term` is a broad relevance/fuzzy search, NOT a literal substring match -- confirmed
// real via a live query: searching "jambojet" returned 48 unrelated Kenya-market apps
// (banks, airlines, delivery apps), none of which actually contain "jambojet" in their
// name. Callers MUST filter results themselves for literal substring containment before
// treating anything as a real candidate.
export async function queryAppStore(brandRoot: string): Promise<AppResult[] | null> {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(brandRoot)}&entity=software&country=us`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    if (!Array.isArray(data.results)) return null;

    return data.results
      .filter((r) => typeof r.trackId === "number" && typeof r.trackViewUrl === "string")
      .map((r) => ({
        trackId: r.trackId as number,
        trackName: (r.trackName as string) ?? "",
        sellerName: (r.sellerName as string) ?? "",
        trackViewUrl: r.trackViewUrl as string,
      }));
  } catch {
    // Network error, timeout, non-2xx, or malformed JSON -- skip this round, next
    // scheduled tick retries. Not worth alerting on a transient failure of a free public
    // service we don't control.
    return null;
  }
}
