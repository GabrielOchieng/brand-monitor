import { AppWindow, AtSign, Globe, Link2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { statusLabel } from "../../lib/format";
import { suspiciousChars } from "../../lib/homoglyph";

// The small, repeated pieces every threat view is built from. Colour is never the only signal:
// severity and status always carry their word too.

export const SEV_TEXT: Record<string, string> = {
  critical: "text-sev-critical",
  high: "text-sev-high",
  medium: "text-sev-medium",
  low: "text-sev-low",
};
export const SEV_BG: Record<string, string> = {
  critical: "bg-sev-critical",
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low",
};

export function SeverityTag({ severity, className }: { severity: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em]", SEV_TEXT[severity] ?? SEV_TEXT.low, className)}>
      <span className="size-2 rounded-[1px] bg-current" aria-hidden="true" />
      {severity}
    </span>
  );
}

// Risk score 0-100 as a number plus a short bar in the severity colour.
export function ScoreMeter({ score, severity }: { score: number; severity: string }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span className={cn("inline-flex items-center gap-2 font-mono text-[13px] font-medium tabular", SEV_TEXT[severity] ?? SEV_TEXT.low)} aria-label={`Risk score ${score} of 100`}>
      <span>{score}</span>
      <span className="h-1 w-[42px] overflow-hidden rounded-full bg-border-strong" aria-hidden="true">
        <span className="block h-full bg-current" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  new: "border-info/40 bg-info/10 text-info",
  investigating: "border-border-strong bg-raised text-muted-foreground",
  confirmed: "border-sev-critical/40 bg-sev-critical/10 text-sev-critical",
  false_positive: "border-border-strong bg-raised text-subtle",
  resolved: "border-ok/40 bg-ok/10 text-ok",
  takedown: "border-primary/40 bg-primary-soft text-primary",
  // Generic tones for other lifecycles (takedown reports, public reports).
  info: "border-info/40 bg-info/10 text-info",
  warn: "border-sev-medium/40 bg-sev-medium/10 text-sev-medium",
  ok: "border-ok/40 bg-ok/10 text-ok",
  danger: "border-sev-critical/40 bg-sev-critical/10 text-sev-critical",
  neutral: "border-border-strong bg-raised text-subtle",
  primary: "border-primary/40 bg-primary-soft text-primary",
};

export function Pill({ tone = "investigating", children, className }: { tone?: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-[21px] items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 text-[11.5px] font-medium", STATUS_TONE[tone] ?? STATUS_TONE.investigating, className)}>
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={status}>{statusLabel(status)}</Pill>;
}

const TYPES: Record<string, { label: string; Icon: typeof Globe }> = {
  domain: { label: "Domain", Icon: Globe },
  url: { label: "URL", Icon: Link2 },
  social: { label: "Social", Icon: AtSign },
  app: { label: "App", Icon: AppWindow },
};

export function TypeTag({ type }: { type: string }) {
  const t = TYPES[type] ?? TYPES.url;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-subtle">
      <t.Icon className="size-3.5" aria-hidden="true" />
      {t.label}
    </span>
  );
}

const WEB_STATE_LABEL = { live: "Live", parked: "Parked", offline: "Offline", suspended: "Suspended" } as const;
const WEB_STATE_DOT = { live: "bg-sev-critical", parked: "bg-sev-medium", offline: "bg-sev-low", suspended: "bg-ok" } as const;

// Live / parked / offline from the latest scan; suspended = the registrar has the domain on hold.
export function WebState({ state }: { state: keyof typeof WEB_STATE_LABEL | null | undefined }) {
  if (!state) return null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <span className={cn("size-[7px] rounded-full", WEB_STATE_DOT[state])} aria-hidden="true" />
      {WEB_STATE_LABEL[state]}
    </span>
  );
}

// A domain, URL or handle in mono, with look-alike characters marked so an analyst sees the trick.
export function Ident({ value, className, highlight = true }: { value: string; className?: string; highlight?: boolean }) {
  const marks = highlight ? suspiciousChars(value) : new Set<number>();
  if (marks.size === 0) return <span className={cn("break-all font-mono text-[0.93em] tracking-[-0.01em]", className)}>{value}</span>;
  return (
    <span className={cn("break-all font-mono text-[0.93em] tracking-[-0.01em]", className)}>
      {Array.from(value).map((ch, i) =>
        marks.has(i) ? (
          <mark key={i} className="rounded-[2px] bg-sev-critical/20 px-px font-medium text-sev-critical" title="Look-alike character">
            {ch}
          </mark>
        ) : (
          ch
        )
      )}
    </span>
  );
}
