// Which findings qualify for an automatic takedown report (TAKEDOWN_AUTOMATION_PLAN.md §7).
// Registrars act on fraud (phishing, scams), not on lookalike names alone, so automation is only
// for clear fraud: a strong signal from the latest scan, or an analyst's confirmation. Pure.

export const SIGNALS = ["login_form", "payment_form", "shared_indicator", "scam_pattern", "visual_match"] as const;
export type Signal = (typeof SIGNALS)[number];

// Score rules (pipeline/scoring.ts) that count as each signal.
export const SIGNAL_RULES: Record<Signal, string[]> = {
  login_form: ["LOGIN_FORM_DETECTED"],
  payment_form: ["PAYMENT_FORM_DETECTED", "PAYMENT_DESTINATION"],
  shared_indicator: ["SHARED_INDICATOR"],
  scam_pattern: ["RECRUITMENT_FEE", "PHISH_FEED_LISTED"],
  visual_match: ["VISUAL_SIMILARITY_MATCH"],
};

export const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export const LIVE_SCANS_NEEDED = 2;
export const SCREENSHOT_MAX_AGE_HOURS = 24;

export interface PolicySettings {
  minSeverity: string;
  signals: string[];
}

export interface PolicyFinding {
  type: string;
  status: string;
  severity: string;
  domain: string;
  liveStreak: number;
  downSince: Date | null;
  ruleCodes: string[]; // positive score events of the latest scan
  screenshotAt: Date | null; // latest scan with a screenshot
}

export type PolicyResult =
  | { qualifies: true; via: "confirmed" | "signals"; signals: Signal[] }
  | { qualifies: false; reason: string };

const underDomain = (d: string, parent: string) => d === parent || d.endsWith(`.${parent}`);

export function evaluatePolicy(f: PolicyFinding, p: PolicySettings, ownDomains: string[], now = new Date()): PolicyResult {
  if (f.type !== "domain" && f.type !== "url") return { qualifies: false, reason: "Only websites are reported automatically." };
  if (f.status === "false_positive" || f.status === "resolved") return { qualifies: false, reason: `The finding is marked ${f.status.replace("_", " ")}.` };
  if (ownDomains.some((d) => underDomain(f.domain.toLowerCase(), d.toLowerCase()))) return { qualifies: false, reason: "It's one of your own or allowlisted domains." };
  if (f.downSince || f.liveStreak < LIVE_SCANS_NEEDED) return { qualifies: false, reason: `The site hasn't been live on ${LIVE_SCANS_NEEDED} scans in a row.` };
  if (!f.screenshotAt || now.getTime() - f.screenshotAt.getTime() > SCREENSHOT_MAX_AGE_HOURS * 3600_000) {
    return { qualifies: false, reason: `No screenshot from the last ${SCREENSHOT_MAX_AGE_HOURS} hours.` };
  }

  const signals = SIGNALS.filter((s) => p.signals.includes(s) && SIGNAL_RULES[s].some((r) => f.ruleCodes.includes(r)));
  if (f.status === "confirmed") return { qualifies: true, via: "confirmed", signals };
  if ((SEVERITY_RANK[f.severity] ?? -1) < (SEVERITY_RANK[p.minSeverity] ?? 3)) return { qualifies: false, reason: `Severity is ${f.severity}; the policy needs ${p.minSeverity} or an analyst's confirmation.` };
  if (signals.length === 0) return { qualifies: false, reason: "No fraud signal (login or payment form, shared contact details, scam pattern) and not confirmed by an analyst." };
  return { qualifies: true, via: "signals", signals };
}

// When a report in "delayed" mode goes out: after the veto window, or at once for a finding an
// analyst confirmed when the org lets confirmations skip it.
export function sendAfterFor(mode: string, viaConfirmed: boolean, s: { vetoHours: number; confirmedSkipsVeto: boolean }, now = new Date()): Date | null {
  if (mode === "automatic") return now;
  if (mode === "delayed") return viaConfirmed && s.confirmedSkipsVeto ? now : new Date(now.getTime() + s.vetoHours * 3600_000);
  return null;
}

// Status a new automatic report starts in.
export function initialStatus(stage: string, mode: string, routingMethod: string): "shadow" | "manual" | "awaiting_approval" | "pending_veto" | "queued" {
  if (stage === "shadow") return "shadow";
  if (routingMethod !== "email" && routingMethod !== "api") return "manual";
  if (mode === "approval") return "awaiting_approval";
  if (mode === "delayed") return "pending_veto";
  return "queued";
}

export const CHANNEL_MODES = ["off", "approval", "delayed", "automatic"] as const;
export const STAGES = ["shadow", "redirect", "live"] as const;

// Statuses whose text and recipients can still be edited (nothing sent yet).
export const EDITABLE_STATUSES = ["draft", "awaiting_approval", "pending_veto", "queued", "manual", "failed"];
// Statuses that count as "already reported" for dedup (everything; a cancel is a decision too).
export const ACTION_STATUSES = ["draft", "shadow", "manual", "awaiting_approval", "pending_veto", "queued", "sending", "sent", "failed", "cancelled", "skipped"] as const;
