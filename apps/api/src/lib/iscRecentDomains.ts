import { gunzipSync } from "node:zlib";
import { env } from "../env";

// SANS Internet Storm Center "recent domains": every domain ISC first saw on the previous
// day, compiled from Certificate Transparency logs and ICANN zone files (~335k/day on
// 2026-11-21, gTLDs only -- no .co.ke). One ~3 MB gzipped JSON file, refreshed hourly.
// Free, no key; ISC asks automated clients to identify themselves in the User-Agent with a
// way to contact them (ISC_CONTACT). Terms: an ISC diary (2025-11-05) allows commercial
// use with attribution and no resale, while the API page links CC BY-NC-SA -- still to be
// confirmed with ISC. Credit "SANS Internet Storm Center" wherever its data is shown.
// The JSON API also has a substring search, but its answers can be truncated, so the
// whole file is used instead.
export const ISC_FEED_URL = "https://isc.sans.edu/feeds/domaindata.json.gz";

export type IscResult = { status: "ok"; total: number; firstSeen: string | null; matched: string[] } | { status: "error"; error: string };

export function iscUserAgent(contact: string = env.iscContact): string {
  return contact ? `BrandMonitor/1.0 (brand-protection monitoring; contact: ${contact})` : "BrandMonitor/1.0 (brand-protection monitoring)";
}

// Pulls domain names out of the feed text without building ~335k objects: the file is a
// JSON array of {"domainname": "...", "ip": ..., "firstseen": "YYYY-MM-DD", ...}.
export function extractIscDomains(text: string, keep: (domain: string) => boolean): { total: number; firstSeen: string | null; matched: string[] } {
  const matched: string[] = [];
  let total = 0;
  for (const m of text.matchAll(/"domainname":\s*"([^"]+)"/g)) {
    total++;
    const d = m[1].trim().toLowerCase();
    if (keep(d)) matched.push(d);
  }
  const firstSeen = /"firstseen":\s*"(\d{4}-\d{2}-\d{2})"/.exec(text)?.[1] ?? null;
  return { total, firstSeen, matched };
}

export async function fetchIscRecentDomains(keep: (domain: string) => boolean, minDomains = 10_000): Promise<IscResult> {
  try {
    const res = await fetch(ISC_FEED_URL, { headers: { "User-Agent": iscUserAgent() }, signal: AbortSignal.timeout(2 * 60 * 1000) });
    if (!res.ok) return { status: "error", error: `HTTP ${res.status}` };
    const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
    const result = extractIscDomains(text, keep);
    // An empty or truncated file must not count as a successful run.
    if (result.total < minDomains) return { status: "error", error: `only ${result.total} domains` };
    return { status: "ok", ...result };
  } catch (err: any) {
    return { status: "error", error: String(err?.message ?? err) };
  }
}
