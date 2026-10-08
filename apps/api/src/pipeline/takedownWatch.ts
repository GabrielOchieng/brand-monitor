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
  reactivated: boolean;
}

// A finding is under post-takedown watch once it's resolved or has a completed takedown.
// Two states: unconfirmed (downSince null) and confirmed down. Live content while
// confirmed down = reactivated, which resets to unconfirmed so a second takedown cycle
// can fire again.
export function nextTakedownWatch(input: {
  underWatch: boolean;
  downSince: Date | null;
  definitelyDown: boolean;
  live: boolean;
  now: Date;
}): TakedownWatchState {
  if (!input.underWatch) return { downSince: null, reactivated: false };
  if (input.downSince && input.live) return { downSince: null, reactivated: true };
  if (!input.downSince && input.definitelyDown) return { downSince: input.now, reactivated: false };
  return { downSince: input.downSince, reactivated: false };
}
