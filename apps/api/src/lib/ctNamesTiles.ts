// Certificate Transparency via "names tiles", replacing the crt.sh search (constantly down).
//
// Static CT logs (c2sp.org/static-ct-api) publish entries as immutable 256-entry tiles. Many
// of them (Let's Encrypt Sycamore/Willow, Geomys, IPng Gouda, Microsec, GoDaddy, HARICA, as
// probed 2026-11-21) also serve an unauthenticated names-only copy of each tile at
// `<monitoring url>tile/names/<N>`: gzip'd JSON lines of {Timestamp, Subject, DNS}, about
// 24 bytes per entry on the wire against ~660 for the full tile. Reading new names tiles is
// a few GB/day at near-zero CPU, where a full CT stream (certstream) measured ~130 GB/day
// and a core. Google and Sectigo logs, and every RFC 6962 log, don't serve names tiles.
// Both Let's Encrypt logs together saw ~70% of all newly logged names in a sample; all seven
// names-tile logs ~84%. Spec: github.com/FiloSottile/sunlight/blob/main/names-tiles.md
//
// Unauthenticated by design: names tiles can't be checked against the log's signed tree
// head. Fine here -- a forged name only creates a finding that the recheck then scans.

export const CT_LOG_LIST_URL = "https://www.gstatic.com/ct/log_list/v3/log_list.json";
export const TILE_WIDTH = 256;

export type TiledLog = { operator: string; description: string; monitoringUrl: string };

// Logs worth reading now: accepting new certificates (usable/qualified) and whose shard
// still covers certificates that haven't expired yet. `operators` empty = every operator.
export function selectTiledLogs(logList: any, operators: string[], now: Date = new Date()): TiledLog[] {
  const wanted = operators.map((o) => o.toLowerCase());
  const out: TiledLog[] = [];
  for (const op of logList?.operators ?? []) {
    const opName = String(op?.name ?? "");
    if (wanted.length && !wanted.includes(opName.toLowerCase())) continue;
    for (const log of op?.tiled_logs ?? []) {
      const state = Object.keys(log?.state ?? {})[0];
      if (state !== "usable" && state !== "qualified") continue;
      const end = log?.temporal_interval?.end_exclusive;
      if (end && new Date(end).getTime() <= now.getTime()) continue;
      if (typeof log?.monitoring_url !== "string") continue;
      const url = log.monitoring_url.endsWith("/") ? log.monitoring_url : `${log.monitoring_url}/`;
      out.push({ operator: opName, description: String(log.description ?? url), monitoringUrl: url });
    }
  }
  return out;
}

// tlog-tiles path encoding: 1234067 -> "x001/x234/067".
export function tilePath(index: number): string {
  const groups: string[] = [];
  let n = index;
  do {
    groups.unshift(String(n % 1000).padStart(3, "0"));
    n = Math.floor(n / 1000);
  } while (n > 0);
  return groups.map((g, i) => (i < groups.length - 1 ? `x${g}` : g)).join("/");
}

// Checkpoint body: origin line, tree size line, root hash line, blank line, signatures.
export function parseCheckpointSize(text: string): number {
  const size = Number(text.split("\n")[1]);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("malformed checkpoint");
  return size;
}

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeHostname(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return HOSTNAME_PATTERN.test(h) ? h : null;
}

// Returns the names in one tile that `keep` accepts, plus how many entries were read.
export function matchNamesTile(text: string, keep: (hostname: string) => boolean): { entries: number; matched: string[] } {
  const matched = new Set<string>();
  let entries = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    entries++;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const names: unknown[] = Array.isArray(entry?.DNS) ? [...entry.DNS] : [];
    if (typeof entry?.Subject?.CommonName === "string") names.push(entry.Subject.CommonName);
    for (const raw of names) {
      if (typeof raw !== "string") continue;
      const h = normalizeHostname(raw);
      if (h && keep(h)) matched.add(h);
    }
  }
  return { entries, matched: [...matched] };
}

export class RateLimitedError extends Error {}
export class NoNamesTilesError extends Error {}

const HEADERS = { "User-Agent": "BrandMonitor/1.0 (brand-protection CT monitor)" };

export async function fetchLogList(): Promise<any> {
  const res = await fetch(CT_LOG_LIST_URL, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`log list HTTP ${res.status}`);
  return res.json();
}

export async function fetchTreeSize(log: TiledLog): Promise<number> {
  const res = await fetch(`${log.monitoringUrl}checkpoint`, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new RateLimitedError("checkpoint HTTP 429");
  if (!res.ok) throw new Error(`checkpoint HTTP ${res.status}`);
  return parseCheckpointSize(await res.text());
}

// fetch() undoes the gzip Content-Encoding itself.
export async function fetchNamesTile(log: TiledLog, index: number): Promise<string> {
  const res = await fetch(`${log.monitoringUrl}tile/names/${tilePath(index)}`, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (res.status === 429) throw new RateLimitedError("tile HTTP 429");
  if (res.status === 404) throw new NoNamesTilesError("names tile HTTP 404");
  if (!res.ok) throw new Error(`tile HTTP ${res.status}`);
  return res.text();
}
