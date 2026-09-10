const STYLES: Record<string, string> = {
  critical: "bg-red-600/20 text-red-400 border-red-600/40",
  high: "bg-orange-600/20 text-orange-400 border-orange-600/40",
  medium: "bg-yellow-600/20 text-yellow-400 border-yellow-600/40",
  low: "bg-gray-600/20 text-gray-400 border-gray-600/40",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const style = STYLES[severity] ?? STYLES.low;
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${style}`}>
      {severity}
    </span>
  );
}
