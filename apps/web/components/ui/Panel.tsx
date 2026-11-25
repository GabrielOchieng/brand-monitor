import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

// A bordered block of related content. Borders, not shadows, separate things in the console.
export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("min-w-0 rounded-md border border-border bg-card", className)} {...props} />;
}

type PanelHeaderProps = { title: ReactNode; count?: number | string; action?: ReactNode; className?: string };

export function PanelHeader({ title, count, action, className }: PanelHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5", className)}>
      <h2 className="flex items-center gap-2 text-[13px] font-semibold">
        {title}
        {count !== undefined && <span className="font-mono text-xs font-normal text-subtle">{count}</span>}
      </h2>
      {action && <div className="flex shrink-0 items-center gap-2 text-xs">{action}</div>}
    </div>
  );
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-3.5", className)} {...props} />;
}

// A heading inside a panel or side panel: "WHY THIS SCORE".
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="eyebrow text-xs">{children}</h3>
      {action}
    </div>
  );
}
