import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

// A row of summary figures in one bordered strip; the first can be wider. Stacks on phones.
export function StatStrip({ children, className, wideFirst = true, label }: { children: ReactNode; className?: string; wideFirst?: boolean; label: string }) {
  return (
    <section
      aria-label={label}
      className={cn(
        "mb-4 grid grid-cols-1 rounded-md border border-border bg-card sm:grid-cols-2",
        wideFirst ? "xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]" : "xl:grid-cols-4",
        "[&>*]:border-border max-sm:[&>*+*]:border-t sm:max-xl:[&>*:nth-child(n+3)]:border-t sm:max-xl:[&>*:nth-child(even)]:border-l xl:[&>*+*]:border-l",
        className
      )}
    >
      {children}
    </section>
  );
}

type StatProps = { label: string; value: ReactNode; note?: ReactNode; children?: ReactNode; tone?: string };

export function Stat({ label, value, note, children, tone }: StatProps) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 flex items-baseline gap-2 text-[26px] font-semibold tracking-[-0.02em] tabular">
        <span className={tone}>{value}</span>
        {note && <small className="text-xs font-normal tracking-normal text-subtle">{note}</small>}
      </div>
      {children}
    </div>
  );
}
