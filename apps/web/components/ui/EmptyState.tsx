import type { ReactNode } from "react";

// What a list shows when it has nothing: what would appear here, and what to do next.
type EmptyStateProps = { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode };

export function EmptyState({ title, children, action, icon }: EmptyStateProps) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand">{icon}</div>}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm leading-relaxed text-ink-subtle">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
