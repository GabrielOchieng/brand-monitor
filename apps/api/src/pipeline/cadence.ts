const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DORMANT_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

// Recency-weighted recheck cadence: aggressive right after discovery (this is the
// product's core "catch it before it goes live" window), backing off as a finding ages
// and nothing has forced re-investigation. Deliberately a small fixed lookup table, not
// an adaptive/configurable rules engine -- ARCHITECTURE.md is explicit that this doesn't
// need per-tenant configuration at MVP.
//
// isDormant overrides the age-based backoff entirely: a registered-but-not-yet-hosting
// domain (still just a parked/placeholder page) stays on the same aggressive cadence as
// a brand-new finding indefinitely, not just for its first 3 days -- these are exactly
// the findings where "goes live tomorrow" is the real threat, and the whole point is to
// catch that moment quickly rather than finding out up to a day later. Deliberate,
// accepted tradeoff: WHOIS/scanner load grows with however many findings sit dormant,
// since there's no outer cap here -- the existing recheck dispatcher's
// `status NOT IN ('false_positive','resolved')` filter (queue/dispatch.ts) is the only
// off-ramp, same as it already is for the age-based backoff below.
export function computeNextScanAt(firstDetectedAt: Date, now: Date = new Date(), isDormant: boolean = false): Date {
  if (isDormant) return new Date(now.getTime() + DORMANT_INTERVAL_MS);

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
