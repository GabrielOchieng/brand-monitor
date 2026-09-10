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

// settleMs (extra wait after domcontentloaded before the screenshot -- see
// apps/scanner/src/server.ts) is only ever passed for a brand's own reference-screenshot
// capture, never a candidate scan. The client-side timeout scales with it so adding
// settle time doesn't just recreate the same 25s-timeout-vs-real-response-time problem
// this codebase has already hit more than once for plain candidate scans.
export async function scanWebsite(url: string, userAgent: string, settleMs?: number): Promise<ScanResult> {
  try {
    const res = await fetch(`${env.scannerUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, userAgent, ...(settleMs ? { settleMs } : {}) }),
      signal: AbortSignal.timeout(25_000 + (settleMs ?? 0)),
    });
    if (!res.ok) return { skipped: true, reason: `scanner_http_${res.status}` };
    return (await res.json()) as ScanResult;
  } catch {
    return { skipped: true, reason: "scanner_unreachable" };
  }
}
