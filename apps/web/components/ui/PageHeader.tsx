import type { ReactNode } from "react";

// The top of every app page: title, one line of context, and the page's actions on the right.
type PageHeaderProps = { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode };

export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-5">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-ink-subtle">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {description && <div className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-subtle">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
