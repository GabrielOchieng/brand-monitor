import { adminPrisma } from "../adminDb";
import { env } from "../env";
import {
  fetchLogList,
  fetchNamesTile,
  fetchTreeSize,
  matchNamesTile,
  NoNamesTilesError,
  RateLimitedError,
  selectTiledLogs,
  TILE_WIDTH,
  type TiledLog,
} from "../lib/ctNamesTiles";
import { markSourceSuccess } from "../queue/health";
import { createFindings, loadBrandMatch } from "./nrdMonitorJob";

// Reads every newly logged certificate name from the CT logs that publish names tiles
// (lib/ctNamesTiles.ts) and turns brand matches into `ct_log` findings. One global job every
// 5 minutes: one read of each log serves every brand. Replaced the per-brand crt.sh search,
// which was down far more often than up and never produced a production finding.
//
// Complementary to discoveryJob.ts (guessed names) and the new-domain feeds: a certificate
// shows up within minutes of issuance, usually before a phishing site goes live, and also
// catches lookalike subdomains on platforms that issue per-site certificates.

// Enough to keep up with the busiest log (LE Sycamore, ~360 tiles per 5 minutes) with room
// to catch up after a restart. Behind by more than MAX_BACKLOG_TILES (~half a day on
// Sycamore; a long outage), the gap is skipped rather than downloaded.
const MAX_TILES_PER_RUN = 2000;
const MAX_BACKLOG_TILES = 20_000;
// Per log; logs are read in parallel. At 4, a 5-minute backlog (~360 tiles) took ~110s from
// Nairobi -- fine for steady state, slow for catching up.
const TILE_CONCURRENCY = 6;
const RUN_BUDGET_MS = 4 * 60 * 1000; // stop before the next 5-minute tick

// The log list changes a few times a year; names-tile support is probed once per log.
const LOG_LIST_TTL_MS = 6 * 60 * 60 * 1000;
const NAMES_PROBE_TTL_MS = 24 * 60 * 60 * 1000;
let logListCache: { at: number; logs: TiledLog[] } | null = null;
const namesSupport = new Map<string, { supported: boolean; at: number }>();

async function currentLogs(now: number): Promise<TiledLog[]> {
  if (!logListCache || now - logListCache.at > LOG_LIST_TTL_MS) {
    logListCache = { at: now, logs: selectTiledLogs(await fetchLogList(), env.ctLogOperators, new Date(now)) };
  }
  return logListCache.logs;
}

type LogResult = { log: TiledLog; ok: boolean; tiles: number; entries: number; matched: string[]; note?: string };

async function readLog(log: TiledLog, keep: (h: string) => boolean, deadline: number): Promise<LogResult> {
  const result: LogResult = { log, ok: false, tiles: 0, entries: 0, matched: [] };
  const fullTiles = Math.floor((await fetchTreeSize(log)) / TILE_WIDTH);
  if (fullTiles === 0) return { ...result, ok: true };

  // New logs start at the tip: only certificates logged from now on are interesting.
  const cursor = await adminPrisma.ctLogCursor.findUnique({ where: { monitoringUrl: log.monitoringUrl } });
  let next = Math.max(0, cursor?.nextTile ?? fullTiles);
  if (fullTiles - next > MAX_BACKLOG_TILES) {
    result.note = `skipped ${fullTiles - MAX_TILES_PER_RUN - next} tiles of backlog`;
    next = fullTiles - MAX_TILES_PER_RUN;
  }

  // Probe once: does this log serve names tiles at all? (Google/Sectigo logs 404.)
  const probe = namesSupport.get(log.monitoringUrl);
  if (!probe || Date.now() - probe.at > NAMES_PROBE_TTL_MS) {
    try {
      await fetchNamesTile(log, fullTiles - 1);
      namesSupport.set(log.monitoringUrl, { supported: true, at: Date.now() });
    } catch (err) {
      if (!(err instanceof NoNamesTilesError)) throw err;
      namesSupport.set(log.monitoringUrl, { supported: false, at: Date.now() });
    }
  }
  if (!namesSupport.get(log.monitoringUrl)!.supported) return { ...result, note: "no names tiles" };

  const end = Math.min(fullTiles, next + MAX_TILES_PER_RUN);
  const matched = new Set<string>();
  try {
    while (next < end && Date.now() < deadline) {
      const batch = Array.from({ length: Math.min(TILE_CONCURRENCY, end - next) }, (_, i) => next + i);
      const texts = await Promise.all(batch.map((i) => fetchNamesTile(log, i)));
      for (const text of texts) {
        const tile = matchNamesTile(text, keep);
        result.entries += tile.entries;
        tile.matched.forEach((h) => matched.add(h));
      }
      next += batch.length;
      result.tiles += batch.length;
    }
    result.ok = true;
  } catch (err: any) {
    // Resume from the last complete batch next run. A 429 (Geomys rate-limits) just ends
    // this log's turn; anything else is logged too.
    result.note = err instanceof RateLimitedError ? "rate limited" : String(err?.message ?? err);
    result.ok = err instanceof RateLimitedError;
  }

  await adminPrisma.ctLogCursor.upsert({
    where: { monitoringUrl: log.monitoringUrl },
    create: { monitoringUrl: log.monitoringUrl, nextTile: next },
    update: { nextTile: next },
  });
  result.matched = [...matched];
  return result;
}

export async function runCtMonitorJob(now: number = Date.now()): Promise<void> {
  const brands = await adminPrisma.brand.findMany({ select: { id: true, organizationId: true } });
  if (brands.length === 0) return;
  const contexts = await Promise.all(brands.map((b) => loadBrandMatch(b.id, b.organizationId)));
  const keep = (h: string) => contexts.some((c) => c.keep(h));

  let logs: TiledLog[];
  try {
    logs = await currentLogs(now);
  } catch (err: any) {
    console.warn(`[ct-tiles] log list unavailable: ${err?.message ?? err}`);
    return;
  }
  if (logs.length === 0) {
    console.warn(`[ct-tiles] no tiled logs match CT_LOG_OPERATORS=${env.ctLogOperators.join(",")}`);
    return;
  }

  const deadline = now + RUN_BUDGET_MS;
  const settled = await Promise.allSettled(logs.map((log) => readLog(log, keep, deadline)));

  const matched = new Set<string>();
  let tiles = 0;
  let entries = 0;
  let okLogs = 0;
  settled.forEach((s, i) => {
    if (s.status === "rejected") {
      console.warn(`[ct-tiles] ${logs[i].description}: ${s.reason?.message ?? s.reason}`);
      return;
    }
    const r = s.value;
    tiles += r.tiles;
    entries += r.entries;
    r.matched.forEach((h) => matched.add(h));
    if (r.ok) okLogs++;
    if (r.note && r.note !== "no names tiles") console.warn(`[ct-tiles] ${r.log.description}: ${r.note}`);
  });

  for (const ctx of contexts) {
    await createFindings(ctx, [...matched].filter(ctx.keep), "ct_log");
  }
  console.log(`[ct-tiles] ${okLogs}/${logs.length} logs, ${tiles} tiles, ${entries} entries, ${matched.size} matched a brand`);
  // Stale on /health/jobs only if no log at all has answered for an hour.
  if (okLogs > 0) markSourceSuccess("ct_log");
}
