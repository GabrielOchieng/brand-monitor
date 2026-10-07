import { inflateRawSync } from "node:zlib";

// whoisds.com's free daily newly-registered-domains list: one zip per day holding a
// plain-text file of domain names, free for commercial reuse per the site's own terms.
// Capped at 70,000 domains/day -- a sample of real daily registration volume, not all of
// it -- but it covers every TLD (incl. .store/.ke), needs no key, and catches squats
// regardless of naming pattern or whether a TLS cert was ever issued. ~0.5 MB per day.
// The site only lists the last 4 days, but older files stay downloadable by URL (verified
// back to weeks earlier), so missed days can be backfilled.
//
// URL path is base64("YYYY-MM-DD.zip"), where the date is the registration date (the
// file appears the following day).
export function nrdUrl(date: string): string {
  return `https://www.whoisds.com/whois-database/newly-registered-domains/${Buffer.from(`${date}.zip`).toString("base64")}/nrd`;
}

// Minimal single-entry zip reader -- the feed is always one deflated text file, which
// doesn't justify a dependency. Reads sizes from the central directory (local headers may
// defer them to a trailing data descriptor).
export function unzipSingleFile(buf: Buffer): Buffer {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip (no end-of-central-directory record)");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("bad central directory");
  const method = buf.readUInt16LE(cd + 10);
  const compressedSize = buf.readUInt32LE(cd + 20);
  const localOffset = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("bad local file header");
  const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
  const data = buf.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`unsupported zip compression method ${method}`);
}

export type NrdResult = { status: "ok"; domains: string[] } | { status: "unavailable" } | { status: "error"; error: string };

export async function fetchNrdList(date: string): Promise<NrdResult> {
  try {
    const res = await fetch(nrdUrl(date), { signal: AbortSignal.timeout(60000) });
    if (!res.ok) return { status: "error", error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    // Not published yet: the site answers 200 with an empty text/html body.
    if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) return { status: "unavailable" };
    const domains = unzipSingleFile(buf)
      .toString("utf8")
      .split(/\r?\n/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    return { status: "ok", domains };
  } catch (err: any) {
    return { status: "error", error: String(err?.message ?? err) };
  }
}
