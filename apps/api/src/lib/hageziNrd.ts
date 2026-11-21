// hagezi/nrd: a free list of every newly registered domain of the last 7 days, rebuilt
// once a day at 08:00 UTC from Stamus Labs' NRD feed (github.com/hagezi/nrd, GPL-3.0).
// ~390k domains/day across ~890 TLDs incl. .ke -- several times whoisds.com's 70k/day
// sample (lib/nrdFeed.ts), and checked on 2026-11-21 to contain jambojet lookalikes
// whoisds never delivered. One maintainer's project, and Stamus warns its data can lag a
// few days, so it complements whoisds rather than replacing it.
//
// The 7-day file is ~48 MB of plain text (~3M lines), so it is streamed and filtered line
// by line instead of being held in memory. raw.githubusercontent.com first: jsDelivr's
// `@latest` can serve a cached copy for hours, but it is the mirror hagezi recommends, so
// it's the fallback.
export const HAGEZI_NRD7_URLS = [
  "https://raw.githubusercontent.com/hagezi/nrd/main/domains/nrd7.txt",
  "https://cdn.jsdelivr.net/gh/hagezi/nrd@latest/domains/nrd7.txt",
];

export type HageziResult = { status: "ok"; lines: number; matched: string[] } | { status: "error"; error: string };

// Turns one line of the file into a domain, or null for comments/blank lines.
export function parseHageziLine(line: string): string | null {
  const d = line.trim().toLowerCase();
  if (!d || d.startsWith("#") || d.startsWith("!")) return null;
  return d;
}

// Streams the list and returns only the domains `keep` accepts.
export async function fetchHageziNrd(
  keep: (domain: string) => boolean,
  urls: string[] = HAGEZI_NRD7_URLS,
  minLines = 100_000
): Promise<HageziResult> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
      if (!res.ok || !res.body) {
        errors.push(`${url}: HTTP ${res.status}`);
        continue;
      }
      const matched: string[] = [];
      let lines = 0;
      let rest = "";
      const decoder = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        const parts = (rest + decoder.decode(chunk, { stream: true })).split("\n");
        rest = parts.pop() ?? "";
        for (const part of parts) {
          const d = parseHageziLine(part);
          if (!d) continue;
          lines++;
          if (keep(d)) matched.push(d);
        }
      }
      const last = parseHageziLine(rest + decoder.decode());
      if (last) {
        lines++;
        if (keep(last)) matched.push(last);
      }
      // A truncated or emptied file must not count as a successful run.
      if (lines < minLines) {
        errors.push(`${url}: only ${lines} domains`);
        continue;
      }
      return { status: "ok", lines, matched };
    } catch (err: any) {
      errors.push(`${url}: ${String(err?.message ?? err)}`);
    }
  }
  return { status: "error", error: errors.join("; ") };
}
