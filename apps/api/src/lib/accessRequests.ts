import { z } from "zod";
import { escapeHtml } from "./email";

// No control characters: the organization name goes into an email subject.
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "no control characters");

export const AccessRequestSchema = z.object({
  name: line(100),
  email: z.string().trim().email().max(254),
  organization: line(150),
  brands: z.string().trim().min(1).max(1000),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  // Honeypot: hidden from people by CSS, filled in by naive bots.
  website: z.string().optional(),
  turnstileToken: z.string().max(4096).optional(),
});

export type AccessRequestInput = z.infer<typeof AccessRequestSchema>;

export const ACCESS_REQUEST_STATUSES = ["new", "handled", "dismissed"] as const;

export function buildAccessRequestEmail(
  r: { name: string; email: string; organization: string; brands: string; message: string | null },
  adminUrl: string
): { subject: string; text: string; html: string } {
  const subject = `[Brand Monitor] Access request: ${r.organization}`;
  const rows: Array<[string, string]> = [
    ["Name", r.name],
    ["Email", r.email],
    ["Organization", r.organization],
    ["Brands / domains", r.brands],
    ...(r.message ? ([["Message", r.message]] as Array<[string, string]>) : []),
  ];
  const text = `New access request\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nReview it: ${adminUrl}\n`;
  const html = `<p>New access request</p>
<table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="color:#6b7280;vertical-align:top">${k}</td><td style="white-space:pre-wrap">${escapeHtml(v)}</td></tr>`).join("\n")}
</table>
<p><a href="${escapeHtml(adminUrl)}">Review it in the admin panel</a></p>`;
  return { subject, text, html };
}
