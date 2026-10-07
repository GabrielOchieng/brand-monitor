// Backs GET /health/jobs: "are the scheduled jobs actually running", which plain /health
// (process is up) can't answer. Production once ran nothing for 11 days (Render suspended
// the workspace over bandwidth) with nobody noticing -- point an external uptime monitor
// with alerts at this endpoint so a stall like that pages someone the same day.
//
// In-memory on purpose: it reflects whether THIS process's workers are alive, which is
// what matters. dispatch-recheck runs every 5 minutes (+ up to 60s worker polling), so
// 15 minutes of silence means at least two missed ticks, not jitter.
export const JOBS_STALE_AFTER_MS = 15 * 60 * 1000;

const processStartedAt = new Date();
let lastRecheckDispatchAt: Date | null = null;

export function markRecheckDispatched(at: Date = new Date()): void {
  lastRecheckDispatchAt = at;
}

export function jobsHealth(now: Date = new Date(), last: Date | null = lastRecheckDispatchAt, startedAt: Date = processStartedAt) {
  // A freshly (re)started process gets one stale-window of grace before its first tick.
  const reference = last ?? startedAt;
  const ok = now.getTime() - reference.getTime() < JOBS_STALE_AFTER_MS;
  return { ok, lastRecheckDispatchAt: last?.toISOString() ?? null };
}

// Per-source "last time this external feed actually answered". The CT monitor failed
// silently from the day it shipped (crt.sh 502s/timeouts, swallowed as "skip this round")
// and nobody knew until a real squat it should have caught was found by hand. A source
// that hasn't succeeded within its window is reported stale -- by default only as
// information, and as a failure on /health/jobs?sources=1 for a second uptime monitor.
// Kept out of the main `ok` on purpose: crt.sh being down for a day shouldn't look like
// a production outage.
export const SOURCE_STALE_AFTER_MS: Record<string, number> = {
  ct_log: 24 * 60 * 60 * 1000, // runs every 30 min
  nrd: 48 * 60 * 60 * 1000, // one file a day, published at an unpredictable hour
};

const sourceLastSuccess: Record<string, Date> = {};

export function markSourceSuccess(source: string, at: Date = new Date()): void {
  sourceLastSuccess[source] = at;
}

export function sourcesHealth(
  now: Date = new Date(),
  last: Record<string, Date> = sourceLastSuccess,
  startedAt: Date = processStartedAt
) {
  const sources: Record<string, { lastSuccessAt: string | null; stale: boolean }> = {};
  for (const [name, window] of Object.entries(SOURCE_STALE_AFTER_MS)) {
    const reference = last[name] ?? startedAt;
    sources[name] = { lastSuccessAt: last[name]?.toISOString() ?? null, stale: now.getTime() - reference.getTime() >= window };
  }
  return { ok: Object.values(sources).every((s) => !s.stale), sources };
}
