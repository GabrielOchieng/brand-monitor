import type { ReactNode } from "react";

// The top of every app page: title, one line of context, and the page's actions on the right.
type PageHeaderProps = { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode };

export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <div className="mb-[18px] flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-subtle">{eyebrow}</div>}
        <h1 className="text-[18px] font-semibold leading-tight tracking-[-0.015em] text-balance lg:text-[20px]">{title}</h1>
        {description && <div className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
