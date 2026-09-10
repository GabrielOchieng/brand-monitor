const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Recency-weighted recheck cadence: aggressive right after discovery (this is the
// product's core "catch it before it goes live" window), backing off as a finding ages
// and nothing has forced re-investigation. Deliberately a small fixed lookup table, not
// an adaptive/configurable rules engine -- ARCHITECTURE.md is explicit that this doesn't
// need per-tenant configuration at MVP.
export function computeNextScanAt(firstDetectedAt: Date, now: Date = new Date()): Date {
  const ageMs = now.getTime() - firstDetectedAt.getTime();

  let intervalMs: number;
  if (ageMs < 3 * DAY_MS) {
    intervalMs = 20 * 60 * 1000; // 20 minutes
  } else if (ageMs < 7 * DAY_MS) {
    intervalMs = 2 * HOUR_MS;
  } else {
    intervalMs = DAY_MS;
  }

  return new Date(now.getTime() + intervalMs);
}
