// Small derived values the console shows next to a finding, computed from stored data only.

import { isOnHold } from "./rdap";

export type WebState = "live" | "parked" | "offline" | "suspended";

const DOWN_STATUSES = new Set([404, 410, 451]);

interface WebInput {
  type: string;
  downSince: Date | null;
  websiteIntel: { looksParked: boolean; httpStatus: number | null } | null;
  // Optional so callers that don't load it keep the old behaviour.
  domainIntel?: { statusCodes: string[]; currentlyResolves: boolean; firstResolvedAt: Date | null } | null;
}

// What the site looked like at the last successful scan, unless the registry or DNS says it's
// gone since: a failed scan leaves website_intel untouched, so it would still say "live" for a
// suspended domain (jambojetbooking.online, 2026-11). Social accounts and apps aren't scanned
// (null), and neither is a finding whose first scan hasn't run yet. Same rules as lib/siteGone.ts.
export function webState(f: WebInput): WebState | null {
  if (f.type === "social") return null;
  const di = f.domainIntel;
  if (di && isOnHold(di.statusCodes)) return "suspended";
  if (f.downSince) return "offline";
  if (di && di.firstResolvedAt && !di.currentlyResolves) return "offline";
  const wi = f.websiteIntel;
  if (!wi) return null;
  if (wi.httpStatus != null && (DOWN_STATUSES.has(wi.httpStatus) || wi.httpStatus >= 500)) return "offline";
  if (wi.looksParked) return "parked";
  return "live";
}

// The single biggest reason behind the current score: the one line a list shows under the name.
export function topReason(events: Array<{ delta: number; reason: string }>): string | null {
  let best: { delta: number; reason: string } | null = null;
  for (const e of events) if (e.delta > 0 && (!best || e.delta > best.delta)) best = e;
  return best?.reason ?? null;
}

// Findings first detected on each of the last `days` days, oldest first, today last.
export function perDay(dates: Date[], now: Date, days = 14): number[] {
  const counts = new Array<number>(days).fill(0);
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const DAY = 86_400_000;
  for (const d of dates) {
    const ago = Math.floor((startOfToday - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / DAY);
    if (ago >= 0 && ago < days) counts[days - 1 - ago]++;
  }
  return counts;
}

// Median days from requested to resolved, one decimal; null when nothing has been resolved.
export function medianDays(pairs: Array<{ requestedAt: Date; resolvedAt: Date }>): number | null {
  if (pairs.length === 0) return null;
  const days = pairs.map((p) => (p.resolvedAt.getTime() - p.requestedAt.getTime()) / 86_400_000).sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const m = days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
  return Math.round(m * 10) / 10;
}
