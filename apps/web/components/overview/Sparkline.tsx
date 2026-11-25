// A small trend line: area, line and the latest point. Values are drawn to one scale from 0 to the
// series maximum; the label says what the series is, since a sparkline has no axis.
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const W = 200;
  const H = 34;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values.map((v, i) => [i * step, H - 3 - (v / max) * (H - 8)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-1.5 block h-[34px] w-full" role="img" aria-label={label}>
      <line x1="0" y1={H - 3} x2={W} y2={H - 3} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,${H - 3} ${line} ${W},${H - 3}`} fill="var(--primary-soft)" />
      <polyline points={line} fill="none" stroke="var(--primary)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={last[0]} cy={last[1]} r="2.6" fill="var(--primary)" />}
    </svg>
  );
}
