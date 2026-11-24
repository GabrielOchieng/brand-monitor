import { z } from "zod";

// Cloudflare's abuse-reports API (step 6 of TAKEDOWN_AUTOMATION_PLAN.md), for sites behind
// Cloudflare. Instead of its web form (a manual task), a report is submitted by API. Only accounts
// with the "abuse-reports" entitlement can use it (Enterprise by default, others ask Cloudflare);
// without it Cloudflare answers 401. The API token needs the "Trust and Safety Write" permission.
//
// Endpoint (developers.cloudflare.com/api/resources/abuse_reports, read 2026-11-29):
//   POST https://api.cloudflare.com/client/v4/accounts/{account_id}/abuse-reports/{report_type}
// The docs show the report type only as a placeholder; "abuse_phishing" (the body's `act`) is used
// for it. If Cloudflare rejects it, the report fails visibly and can be sent through the form.

const BASE = "https://api.cloudflare.com/client/v4";
const TIMEOUT_MS = 20_000;

export const CloudflareConfigSchema = z.object({
  accountId: z.string().trim().regex(/^[0-9a-f]{32}$/i, "a 32-character account ID"),
  apiToken: z.string().trim().min(20).max(200),
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(254),
  company: z.string().trim().max(100).optional().nullable().transform((v) => v || null),
  tele: z.string().trim().max(20).optional().nullable().transform((v) => v || null),
  // Whether Cloudflare passes the reporter's details on: "send" or "send-anon". Defaults: the host
  // sees who reported; the site owner (the scammer) doesn't.
  hostNotification: z.enum(["send", "send-anon"]).default("send"),
  ownerNotification: z.enum(["send", "send-anon"]).default("send-anon"),
});
export type CloudflareConfig = z.infer<typeof CloudflareConfigSchema>;

export function cloudflarePublicConfig(c: CloudflareConfig) {
  return { accountId: c.accountId, name: c.name, email: c.email, company: c.company, tele: c.tele, hostNotification: c.hostNotification, ownerNotification: c.ownerNotification };
}

export class CloudflareError extends Error {}

// fetch() hides network failures behind "fetch failed"; the cause says which (DNS, TLS, timeout).
async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err: any) {
    throw new CloudflareError(`Can't reach Cloudflare: ${err?.cause?.code ?? err?.cause?.message ?? err?.message ?? err}`);
  }
}

async function errorText(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try {
    const j = JSON.parse(body);
    const msg = j?.errors?.map((e: any) => e?.message).filter(Boolean).join("; ") || j?.message || body;
    return `${res.status} ${msg}`.slice(0, 300);
  } catch {
    return `${res.status} ${body}`.slice(0, 300);
  }
}

// Justification must be 20-5000 characters.
export function phishingReportBody(c: CloudflareConfig, input: { urls: string[]; justification: string; comments?: string | null }) {
  const urls = [...new Set(input.urls)].slice(0, 250);
  let justification = input.justification.trim();
  if (justification.length < 20) justification = `${justification} (phishing site impersonating our brand)`.trim();
  if (justification.length > 5000) justification = `${justification.slice(0, 4980)}\n[shortened]`;
  return {
    act: "abuse_phishing",
    email: c.email,
    email2: c.email,
    name: c.name,
    ...(c.company ? { company: c.company } : {}),
    ...(c.tele ? { tele: c.tele } : {}),
    host_notification: c.hostNotification,
    owner_notification: c.ownerNotification,
    urls: urls.join("\n"),
    justification,
    ...(input.comments ? { comments: input.comments.slice(0, 2000) } : {}),
  };
}

export async function submitPhishingReport(c: CloudflareConfig, input: { urls: string[]; justification: string; comments?: string | null }): Promise<{ reference: string | null }> {
  const res = await call(`${BASE}/accounts/${c.accountId}/abuse-reports/abuse_phishing`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(phishingReportBody(c, input)),
  });
  if (res.status === 401) throw new CloudflareError("Cloudflare refused the report (401): the account may not have the abuse-reports entitlement, or the token lacks Trust and Safety Write.");
  if (!res.ok) throw new CloudflareError(`Cloudflare refused the report: ${await errorText(res)}`);
  const data = (await res.json().catch(() => null)) as { abuse_rand?: string; result?: { abuse_rand?: string } } | null;
  return { reference: data?.abuse_rand ?? data?.result?.abuse_rand ?? null };
}

// The connection check: list the account's reports (reads only, submits nothing).
export async function verifyCloudflare(c: CloudflareConfig): Promise<void> {
  const res = await call(`${BASE}/accounts/${c.accountId}/abuse-reports?per_page=1`, { headers: { Authorization: `Bearer ${c.apiToken}` } });
  if (res.status === 401) throw new CloudflareError("401: the account has no abuse-reports entitlement, or the token lacks Trust and Safety access.");
  if (!res.ok) throw new CloudflareError(await errorText(res));
}

export function isCloudflareHost(hostingOrg: string | null): boolean {
  return !!hostingOrg && hostingOrg.toLowerCase().replace(/[^a-z0-9]/g, "").includes("cloudflare");
}
