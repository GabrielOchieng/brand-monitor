import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "../../lib/cn";
import { Switch } from "../ui/Switch";

// One settings page's main block: a heading, a short explanation and the controls in a panel.
export function Section({ title, description, danger, children }: { title: string; description: ReactNode; danger?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5">
      <SettingsHead title={title} description={description} danger={danger} />
      <div className={cn("min-w-0 rounded-md border border-border bg-card p-4 sm:p-5", danger && "border-sev-critical/40")}>{children}</div>
    </section>
  );
}

export function SettingsHead({ title, description, danger }: { title: string; description?: ReactNode; danger?: boolean }) {
  return (
    <div>
      <h2 className={cn("text-[16px] font-semibold tracking-[-0.01em]", danger && "text-sev-critical")}>{title}</h2>
      {description && <div className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted-foreground">{description}</div>}
    </div>
  );
}

// A titled block inside a settings page.
export function Card({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-md border border-border bg-card", className)}>
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <h3 className="text-[13.5px] font-semibold">{title}</h3>
        {description && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="text-xs text-sev-critical">{error}</span> : hint ? <span className="text-xs text-subtle">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />;
}

export function ReadOnlyNote({ who = "owners and admins" }: { who?: string }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-border bg-raised px-3 py-2 text-xs text-subtle">
      <Lock className="size-3.5 shrink-0" />
      Only {who} can change these settings.
    </p>
  );
}
