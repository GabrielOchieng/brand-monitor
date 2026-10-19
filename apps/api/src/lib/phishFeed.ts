// phishunt.io's public feed of currently-active phishing URLs, aggregated from OpenPhish,
// PhishTank, urlscan.io, Google Safe Browsing and TweetFeed. Picked because it's the only
// free feed checked (2026-10-19) whose terms allow use in a commercial product: the data
// is CC0, no key needed. OpenPhish's own free feed forbids commercial use, PhishTank
// returns 403 to new users, URLhaus is mostly malware-on-raw-IP and wants a key.
//
// feed.txt is ~35 KB (~800 URLs, one per line); feed.json has more fields but is ~1 MB,
// which hourly would eat ~15% of Render's free bandwidth budget -- the URL is all we need.
//
// phishunt's terms forbid presenting a listed URL as *confirmed* phishing on its say-so
// alone, so the UI/score wording says "reported".
export const PHISH_FEED_URL = "https://phishunt.io/feed.txt";

export type PhishFeedResult = { status: "ok"; urls: string[] } | { status: "error"; error: string };

export async function fetchPhishFeed(): Promise<PhishFeedResult> {
  try {
    const res = await fetch(PHISH_FEED_URL, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { status: "error", error: `HTTP ${res.status}` };
    const urls = (await res.text())
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u));
    // A 200 with an empty or HTML body (outage page) would otherwise count as success.
    if (urls.length === 0) return { status: "error", error: "feed returned no URLs" };
    return { status: "ok", urls };
  } catch (err: any) {
    return { status: "error", error: String(err?.message ?? err) };
  }
}
