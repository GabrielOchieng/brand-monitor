// Shared by the settings panel and the admin panel: what each automation blocker means.
// Keys match AutomationBlocker in apps/api/src/lib/takedownAutomation.ts.
export const BLOCKER_LABELS: Record<string, string> = {
  platform_disabled: "Automatic reporting is switched off on this server (AUTO_TAKEDOWN_ENABLED).",
  not_allowed: "A platform admin hasn't allowed it for this organization yet (they check the authorization first).",
  no_sender: "No sender mailbox is connected.",
  sender_untested: "The sender mailbox hasn't passed a test send with its current settings.",
  no_authorization: "No authorization is in force (none recorded, or it's revoked, expired or not started yet).",
  not_enabled: "An owner hasn't turned it on.",
  stopped: "Stop all sending is on.",
  monitoring_paused: "Monitoring is paused by the platform admin.",
  brand_off: "Turned off for this brand.",
};

export const PROVIDER_LABELS: Record<string, string> = {
  graph: "Microsoft 365",
  gmail: "Google Workspace",
  smtp: "SMTP server",
};

export const EVENT_LABELS: Record<string, string> = {
  "sender.save": "Saved the sender mailbox",
  "sender.delete": "Removed the sender mailbox",
  "sender.test": "Sent a test email",
  "authorization.create": "Recorded an authorization",
  "authorization.revoke": "Revoked an authorization",
  "document.upload": "Uploaded a document",
  "document.delete": "Deleted a document",
  enable: "Turned automatic reporting on",
  disable: "Turned automatic reporting off",
  stop: "Stopped all sending",
  resume: "Resumed sending",
  "brand.on": "Turned it on for a brand",
  "brand.off": "Turned it off for a brand",
  "platform.allow": "Allowed it for this organization",
  "platform.disallow": "Withdrew the allowance",
  "template.publish": "Published a report template",
  "template.retire": "Stopped using a report template",
  "template.test": "Sent a template test",
  "draft.test": "Sent a report draft test",
  "profile.save": "Saved the fixed report text",
  "contact.create": "Added a contact-book entry",
  "contact.update": "Changed a contact-book entry",
  "contact.delete": "Deleted a contact-book entry",
  "fixed.save": "Changed the always-also-send-to addresses",
  "blocked.add": "Added to never send to",
  "blocked.remove": "Removed from never send to",
  "redirect.on": "Turned redirect mode on",
  "redirect.off": "Turned redirect mode off",
  "report.sent": "A report was sent",
  "report.approve": "Approved a report",
  "report.cancel": "Cancelled a report",
  "report.manual_done": "Marked a manual task done",
  "report.bounced": "A report bounced",
  "policy.save": "Changed which findings qualify",
  "modes.save": "Changed the channel modes",
  "stage.change": "Changed the stage",
  "replies.on": "Turned reply reading on",
  "replies.off": "Turned reply reading off",
  "integration.save": "Saved the Cloudflare connection",
  "integration.delete": "Disconnected Cloudflare",
  "integration.test": "Checked the Cloudflare connection",
};

export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  loa: "Letter of authorization",
  trademark: "Trademark registration",
  other: "Other",
};

export function authorizationStatus(a: { validFrom: string; expiresAt: string | null; revokedAt: string | null }, now = new Date()): "in_force" | "revoked" | "expired" | "not_started" {
  if (a.revokedAt) return "revoked";
  if (new Date(a.validFrom) > now) return "not_started";
  if (a.expiresAt && new Date(a.expiresAt) <= now) return "expired";
  return "in_force";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const CHANNEL_LABELS: Record<string, string> = {
  registrar: "Registrar",
  host: "Hosting provider",
  cert: "National CERT",
  blocklist: "Blocklist web forms",
};

export const KIND_LABELS: Record<string, string> = {
  first: "First report",
  follow_up: "Follow-up",
  escalation: "Escalation",
};

export const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  pt: "Portuguese",
  de: "German",
  sw: "Swahili",
  ar: "Arabic",
  zh: "Chinese",
  ru: "Russian",
};

export const ACTION_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  shadow: "Test mode (not sent)",
  manual: "Manual task",
  awaiting_approval: "Needs approval",
  pending_veto: "Sending soon",
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

// Pill tone (components/threat/atoms.tsx) per report status.
export const ACTION_STATUS_TONE: Record<string, string> = {
  draft: "neutral",
  shadow: "info",
  manual: "warn",
  awaiting_approval: "warn",
  pending_veto: "primary",
  queued: "primary",
  sending: "primary",
  sent: "ok",
  failed: "danger",
  cancelled: "neutral",
  skipped: "neutral",
};

export const MODE_LABELS: Record<string, string> = {
  off: "Off (by hand only)",
  approval: "Approval: prepared, an analyst sends",
  delayed: "Delayed: sent after the veto window",
  automatic: "Automatic: sent at once",
};

export const SIGNAL_LABELS: Record<string, string> = {
  login_form: "Login form on the page",
  payment_form: "Payment form or payment details",
  shared_indicator: "Contact details shared with another finding",
  scam_pattern: "Scam pattern (recruitment fee, listed in a phishing feed)",
  visual_match: "Looks like your real website",
};
