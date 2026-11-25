const STYLES: Record<string, string> = {
  critical: "bg-sev-critical/10 text-sev-critical border-sev-critical/40",
  high: "bg-sev-high/10 text-sev-high border-sev-high/40",
  medium: "bg-sev-medium/10 text-sev-medium border-sev-medium/40",
  low: "bg-elevated text-ink-muted border-line",
};

type SeverityBadgeProps = { severity: string };

// Severity is never shown by colour alone: the word is always there too.
export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const style = STYLES[severity] ?? STYLES.low;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {severity}
    </span>
  );
}
