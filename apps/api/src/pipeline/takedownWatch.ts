import type { ScanResult } from "../lib/scannerClient";

// What a removed site usually serves: not found, gone, or "unavailable for legal reasons".
// 403/5xx are deliberately excluded -- bot protection and flaky hosts return those for
// sites that are very much live.
const GONE_HTTP_STATUSES = new Set([404, 410, 451]);

export function isGoneStatus(httpStatus: number | null | undefined): boolean {
  return httpStatus != null && GONE_HTTP_STATUSES.has(httpStatus);
}

export function isLiveContent(result: ScanResult | null): boolean {
  return Boolean(result && !result.skipped && !result.looksParked && !isGoneStatus(result.httpStatus));
}

// A positive observation that nothing is being served -- distinct from "the scan failed",
// which says nothing either way (timeouts, robots.txt, scanner restarts).
export function isDefinitelyDown(input: { isDomainType: boolean; dnsExists: boolean; hasAddress: boolean; result: ScanResult | null }): boolean {
  if (input.isDomainType && (!input.dnsExists || !input.hasAddress)) return true;
  const r = input.result;
  if (!r) return false;
  if (r.skipped) return r.reason === "dns_resolution_failed";
  return Boolean(r.looksParked) || isGoneStatus(r.httpStatus);
}

export interface TakedownWatchState {
  downSince: Date | null;
  downStreak: number;
  reactivated: boolean;
}

// Down scans in a row needed to confirm a site down. One isn't enough: the parked-page
// detector occasionally misreads a single scan of a live site (jambojet.net, 2026-09), and
// that alone would arm a false site_reactivated on the next normal scan.
export const DOWN_CONFIRMATIONS = 2;

// A finding is under post-takedown watch once it's resolved or has a completed takedown.
// Two states: unconfirmed (downSince null, counting definitely-down scans in downStreak) and
// confirmed down. Live content while confirmed down = reactivated, which resets to
// unconfirmed so a second takedown cycle can fire again. A failed scan (neither down nor
// live) leaves everything as it was.
export function nextTakedownWatch(input: {
  underWatch: boolean;
  downSince: Date | null;
  downStreak: number;
  definitelyDown: boolean;
  live: boolean;
  now: Date;
}): TakedownWatchState {
  if (!input.underWatch) return { downSince: null, downStreak: 0, reactivated: false };
  if (input.live) return { downSince: null, downStreak: 0, reactivated: input.downSince !== null };
  if (!input.downSince && input.definitelyDown) {
    const downStreak = input.downStreak + 1;
    return downStreak >= DOWN_CONFIRMATIONS
      ? { downSince: input.now, downStreak: 0, reactivated: false }
      : { downSince: null, downStreak, reactivated: false };
  }
  return { downSince: input.downSince, downStreak: input.downStreak, reactivated: false };
}
