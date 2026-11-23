import { env } from "../env";
import { escapeHtml, sendMail } from "../lib/email";

// Account emails: one short paragraph and one button. Table layout with inline styles, same
// reasoning as the alert emails in lib/email.ts.
export function buildAuthEmail(input: { subject: string; intro: string; buttonLabel?: string; url?: string; footer: string }) {
  const { subject, intro, buttonLabel, url, footer } = input;
  const text = [intro, url ? `\n${buttonLabel}: ${url}` : "", `\n${footer}`].join("\n");
  const button =
    url && buttonLabel
      ? `<tr><td style="padding:8px 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#5b4fe0;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px">${escapeHtml(buttonLabel)}</a></td></tr>
         <tr><td style="font-size:12px;color:#6b7280;padding-bottom:16px">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(url)}</span></td></tr>`
      : "";
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;background:#f9fafb;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">
      <tr><td style="font-size:16px;font-weight:600;color:#111827;padding-bottom:12px">Brand Monitor</td></tr>
      <tr><td style="font-size:14px;line-height:20px;color:#374151;padding-bottom:16px">${escapeHtml(intro)}</td></tr>
      ${button}
      <tr><td style="font-size:12px;line-height:18px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px">${escapeHtml(footer)}</td></tr>
    </table>
  </td></tr>
</table>`;
  return { subject, text, html };
}

function link(path: string, token: string): string {
  return `${env.webAppUrl}${path}?token=${encodeURIComponent(token)}`;
}

export async function sendResetPasswordEmail(to: string, token: string): Promise<void> {
  await sendMail({
    to,
    ...buildAuthEmail({
      subject: "Reset your Brand Monitor password",
      intro: "Someone asked to reset the password for this Brand Monitor account. The link works once and expires in 1 hour.",
      buttonLabel: "Choose a new password",
      url: link("/reset-password", token),
      footer: "If you didn't ask for this, ignore this email. Your password stays the same.",
    }),
  });
}

// Existing users after the move off Clerk: same reset flow, longer-lived link, own wording.
export async function sendSetPasswordEmail(to: string, token: string): Promise<void> {
  await sendMail({
    to,
    ...buildAuthEmail({
      subject: "Set a password for Brand Monitor",
      intro:
        "Brand Monitor has a new sign-in. Your account, organization and data are unchanged, but you need to choose a password. The link works once and expires in 7 days.",
      buttonLabel: "Set your password",
      url: link("/reset-password", token),
      footer: "After the link expires, use \"Forgot password\" on the sign-in page.",
    }),
  });
}

export async function sendConfirmNewEmail(to: string, token: string): Promise<void> {
  await sendMail({
    to,
    ...buildAuthEmail({
      subject: "Confirm your new Brand Monitor email",
      intro: "Confirm that this is the new email address for your Brand Monitor account. The link works once and expires in 1 hour.",
      buttonLabel: "Confirm this address",
      url: link("/confirm-email", token),
      footer: "If you didn't ask for this, ignore this email. Nothing changes until the link is used.",
    }),
  });
}

// Sent to the OLD address, so a takeover that changes the email doesn't go unnoticed.
export async function sendEmailChangedNotice(to: string, newEmail: string): Promise<void> {
  await sendMail({
    to,
    ...buildAuthEmail({
      subject: "Your Brand Monitor email was changed",
      intro: `The email for your Brand Monitor account was changed to ${newEmail}. You'll sign in with that address from now on.`,
      footer: "If you didn't do this, contact an owner of your organization straight away.",
    }),
  });
}

export async function sendPasswordChangedNotice(to: string): Promise<void> {
  await sendMail({
    to,
    ...buildAuthEmail({
      subject: "Your Brand Monitor password was changed",
      intro: "The password for your Brand Monitor account was just changed, and every other signed-in device was signed out.",
      buttonLabel: "Reset it",
      url: `${env.webAppUrl}/forgot-password`,
      footer: "If this was you, there's nothing to do. If not, reset your password now.",
    }),
  });
}

export async function sendInviteEmail(to: string, token: string, orgName: string, inviterEmail: string, role: string): Promise<void> {
  await sendMail({
    to,
    ...buildAuthEmail({
      subject: `You're invited to ${orgName} on Brand Monitor`,
      intro: `${inviterEmail} invited you to join ${orgName} on Brand Monitor as ${role === "admin" ? "an" : "a"} ${role}. The invite expires in 7 days.`,
      buttonLabel: "Accept the invite",
      url: link("/invite", token),
      footer: "If you weren't expecting this, ignore this email.",
    }),
  });
}
