import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

// A row of summary figures in one bordered strip; the first can be wider. Two columns on phones
// (a wide first figure spans both), so the strip never pushes the page's content off the screen.
// The 1px gap over a border-coloured background draws the dividers at every column count.
export function StatStrip({ children, className, wideFirst = true, label }: { children: ReactNode; className?: string; wideFirst?: boolean; label: string }) {
  return (
    <section
      aria-label={label}
      className={cn(
        "mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border [&>*]:bg-card",
        wideFirst ? "max-xl:[&>*:first-child]:col-span-2 xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]" : "xl:grid-cols-4",
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
    <div className="min-w-0 px-3.5 py-3 sm:px-4 sm:py-3.5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[22px] font-semibold tracking-[-0.02em] tabular sm:text-[26px]">
        <span className={tone}>{value}</span>
        {note && <small className="text-xs font-normal tracking-normal text-subtle">{note}</small>}
      </div>
      {children}
    </div>
  );
}
