const STYLES: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-yellow-50 text-yellow-800 border-yellow-200",
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
