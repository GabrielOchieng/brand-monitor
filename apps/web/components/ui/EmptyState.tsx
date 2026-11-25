import type { ReactNode } from "react";

// What a list shows when it has nothing: what would appear here, and what to do next.
type EmptyStateProps = { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode };

export function EmptyState({ title, children, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-md border border-dashed border-border-strong px-6 py-10 text-center">
      {icon && <div className="mb-3 grid size-10 place-items-center rounded-full bg-primary-soft text-primary [&_svg]:size-5">{icon}</div>}
      <div className="text-sm font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
