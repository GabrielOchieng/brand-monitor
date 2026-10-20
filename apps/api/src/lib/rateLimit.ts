// Fixed-window limiter in memory. Resets on restart and isn't shared across instances --
// fine for one Render container. IP keys come from X-Forwarded-For behind Render's proxy and
// can be spoofed, so per-IP limits only slow casual abuse; the per-org limits on the
// expensive actions (keyed on the authenticated org) are the ones that hold.
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now: number = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    // Keep the map from growing forever under a flood of distinct keys.
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    return true;
  };
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// Every request except /health*, per client IP. The dashboard makes a few dozen requests a
// minute at most (2s run polling, 30s notification polling, page loads).
export const allowRequest = createRateLimiter(300, MINUTE);
// Screenshots are public static files and the largest thing the API serves (~100-300 KB
// each) -- the cheapest way to burn Render's 5 GB/month outbound budget.
export const allowScreenshot = createRateLimiter(60, MINUTE);
// Per org. A discovery run is ~3k candidates x 4 DNS queries; scheduled runs every 4h
// don't count against this.
export const allowDiscoveryRun = createRateLimiter(12, DAY);
// Per org. Each submission triggers a full scan (~1-1.5 MB), same budget reasoning as
// PUBLIC_REPORT_DAILY_SCAN_CAP.
export const allowManualSubmit = createRateLimiter(50, DAY);
