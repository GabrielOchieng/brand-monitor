import { env } from "../env";

export interface ScanResult {
  skipped: boolean;
  reason?: string;
  finalUrl?: string;
  redirectChain?: string[];
  title?: string | null;
  metaDescription?: string | null;
  extractedText?: string;
  hasLoginForm?: boolean;
  hasPaymentForm?: boolean;
  looksParked?: boolean;
  screenshotBase64?: string | null;
}

// 45s, not 25s: every genuine successful scan observed against this environment's real
// network conditions took 30-40s -- even example.com, about as simple a page as exists --
// so the bottleneck is network/VPN round-trip latency, not page complexity. At 25s, most
// rechecks were silently missing website data entirely (recheckJob.ts skips the
// WebsiteIntel write on a timed-out scan), not failing loudly -- a real, repeatedly-hit
// detection-quality bug, not just an occasional edge case. Real tradeoff, accepted
// deliberately: the recheck queue only runs 3 concurrent scans (queue/dispatch.ts,
// deliberately small for WHOIS rate-limiting reasons), so a slower worst-case per scan
// means somewhat less recheck throughput overall -- judged worth it for a product whose
// core value is evidence-backed explanations, not just a score.
//
// settleMs (extra wait after domcontentloaded before the screenshot -- see
// apps/scanner/src/server.ts) is only ever passed for a brand's own reference-screenshot
// capture, never a candidate scan. The client-side timeout scales with it on top of the
// base budget above.
export async function scanWebsite(url: string, userAgent: string, settleMs?: number): Promise<ScanResult> {
  try {
    const res = await fetch(`${env.scannerUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, userAgent, ...(settleMs ? { settleMs } : {}) }),
      signal: AbortSignal.timeout(45_000 + (settleMs ?? 0)),
    });
    if (!res.ok) return { skipped: true, reason: `scanner_http_${res.status}` };
    return (await res.json()) as ScanResult;
  } catch {
    return { skipped: true, reason: "scanner_unreachable" };
  }
}
