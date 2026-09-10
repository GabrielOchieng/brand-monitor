import nodemailer from "nodemailer";
import { env } from "../env";

const transporter = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpPort === 465,
  auth: { user: env.smtpUser, pass: env.smtpPass },
});

export interface AlertEmailInput {
  to: string;
  findingIdentifier: string;
  findingId: string;
  previousScore: number;
  previousSeverity: string;
  newScore: number;
  newSeverity: string;
}

// Inline styles + a table skeleton, not a <style> block or flex/grid -- Gmail (the client
// this was actually checked against) strips <style> tags in some contexts and has patchy
// CSS support generally; a table-based layout with everything inlined is still the only
// approach that renders consistently across real-world email clients.
const SEVERITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  critical: { bg: "#fee2e2", border: "#fca5a5", text: "#b91c1c" },
  high: { bg: "#ffedd5", border: "#fdba74", text: "#c2410c" },
  medium: { bg: "#fef9c3", border: "#fde047", text: "#a16207" },
  low: { bg: "#f3f4f6", border: "#d1d5db", text: "#4b5563" },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Split from sendAlertEmail so the rendered subject/text/html can be inspected (e.g.
// written to a file and opened in a browser) without needing a real SMTP send.
export function buildAlertEmail(input: AlertEmailInput): { subject: string; text: string; html: string } {
  const link = `${env.webAppUrl}/threats/${input.findingId}`;
  const subject = `[Brand Monitor] ${input.findingIdentifier} is now ${input.newSeverity.toUpperCase()} (${input.newScore}/100)`;

  // A recheck can re-fire this alert while the score/severity haven't actually moved
  // (e.g. a rule re-evaluating on every scan) -- "changed from medium to medium" reads
  // like a bug in the copy even when the underlying event is legitimate, so word it
  // according to whether anything actually changed.
  const unchanged = input.previousSeverity === input.newSeverity && input.previousScore === input.newScore;
  const summaryText = unchanged
    ? `${input.findingIdentifier} remains ${input.newSeverity} (${input.newScore}/100).`
    : `${input.findingIdentifier} changed from ${input.previousSeverity} (${input.previousScore}/100) to ${input.newSeverity} (${input.newScore}/100).`;

  const text = [summaryText, "", `View the full breakdown: ${link}`].join("\n");

  const color = SEVERITY_COLORS[input.newSeverity] ?? SEVERITY_COLORS.low;
  const safeIdentifier = escapeHtml(input.findingIdentifier);
  const safeSeverity = escapeHtml(input.newSeverity.toUpperCase());

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr>
          <td style="padding:24px 28px 0 28px;">
            <p style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#9ca3af;">Brand Monitor Alert</p>
            <p style="margin:8px 0 0 0;font-size:18px;font-weight:600;color:#111827;word-break:break-all;">${safeIdentifier}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;">
            <span style="display:inline-block;padding:4px 10px;border-radius:4px;background-color:${color.bg};border:1px solid ${color.border};color:${color.text};font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">${safeSeverity}</span>
            <span style="display:inline-block;margin-left:8px;font-size:14px;color:#6b7280;">${input.newScore}/100</span>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 24px 28px;">
            <p style="margin:0;font-size:14px;line-height:1.5;color:#374151;">${escapeHtml(summaryText)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 28px 28px;">
            <a href="${link}" style="display:inline-block;padding:10px 18px;border-radius:6px;background-color:#2563eb;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">View full breakdown</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  return { subject, text, html };
}

export async function sendAlertEmail(input: AlertEmailInput): Promise<void> {
  const { subject, text, html } = buildAlertEmail(input);
  await transporter.sendMail({ from: env.smtpFrom, to: input.to, subject, text, html });
}
