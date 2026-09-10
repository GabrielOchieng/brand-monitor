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

export async function scanWebsite(url: string, userAgent: string): Promise<ScanResult> {
  try {
    const res = await fetch(`${env.scannerUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, userAgent }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return { skipped: true, reason: `scanner_http_${res.status}` };
    return (await res.json()) as ScanResult;
  } catch {
    return { skipped: true, reason: "scanner_unreachable" };
  }
}
