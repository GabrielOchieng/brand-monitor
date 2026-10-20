import { z } from "zod";
import { env } from "../env";

// Pieces of the public "report a scam" route (routes/publicReports.ts) that don't touch
// the database, kept here so they can be unit-tested.

export const PublicReportSchema = z
  .object({
    url: z.string().trim().max(2000).optional(),
    phone: z.string().trim().max(40).optional(),
    description: z.string().trim().max(2000).optional(),
    reporterEmail: z.string().trim().email().max(200).optional().or(z.literal("")),
    // Honeypot: hidden from people by CSS, filled in by naive bots.
    website: z.string().optional(),
    turnstileToken: z.string().max(4096).optional(),
  })
  .refine((r) => Boolean(r.url) || Boolean(r.phone), { message: "give a link or a phone number" });

export type PublicReportInput = z.infer<typeof PublicReportSchema>;

// Links to these hosts are contact handles, not websites to scan: "wa.me/2547..." is a
// WhatsApp number, extracted as an indicator instead of becoming a finding.
export const CONTACT_LINK_HOSTS = new Set(["wa.me", "api.whatsapp.com", "t.me", "telegram.me"]);

// Scans triggered by public reports, per brand per rolling 24h. Each scan is ~1-1.5 MB of
// Render's 5 GB/month; past the cap, reports are still saved but wait for an analyst.
export const PUBLIC_REPORT_DAILY_SCAN_CAP = 30;

// Cloudflare Turnstile (free plan). With no secret configured the check is skipped, so
// local dev and a not-yet-configured deployment still work on honeypot + rate limit.
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!env.turnstileSecretKey) return true;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: env.turnstileSecretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    return false;
  }
}
