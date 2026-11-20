// Google Play search (ROADMAP.md Phase 3). Google has no official search API, so this
// uses google-play-scraper, which reads the public store pages. Two costs accepted on
// 2026-11-20: it sits outside Google's terms for automated access, and it breaks when Google
// changes its pages. The volume is one search per brand every 4 hours; a failure returns
// null, shows as a stale `google_play` source on /health/jobs, and the next run retries.
//
// Kenya's storefront: Kenya is overwhelmingly Android. Search is relevance-ranked and
// capped at 20 results (a live search for "jambojet" returned the real FlyJambojet app
// plus 19 unrelated travel apps), so callers must check names themselves.

export interface PlayAppResult {
  appId: string;
  title: string;
  developer: string;
  url: string;
}

type Gplay = { search(opts: { term: string; country: string; lang: string; num: number }): Promise<Array<Record<string, unknown>>> };
let gplay: Gplay | null = null;

export async function queryGooglePlay(term: string): Promise<PlayAppResult[] | null> {
  try {
    // ESM-only package; loaded on first use.
    gplay ??= ((await import("google-play-scraper")) as unknown as { default: Gplay }).default;
    const results = await Promise.race([
      gplay.search({ term, country: "ke", lang: "en", num: 50 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
    ]);
    return results
      .filter((r) => typeof r.appId === "string")
      .map((r) => ({
        appId: r.appId as string,
        title: typeof r.title === "string" ? r.title : "",
        developer: typeof r.developer === "string" ? r.developer : "",
        url: typeof r.url === "string" ? r.url : `https://play.google.com/store/apps/details?id=${r.appId}`,
      }));
  } catch (err: any) {
    console.warn(`[google-play] search for "${term}" failed: ${err?.message ?? err}`);
    return null;
  }
}
