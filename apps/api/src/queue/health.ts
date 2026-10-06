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
