import type { ReactNode } from "react";

// One settings block: what it is on the left, the controls in a card on the right.
export function Section({
  title,
  description,
  danger,
  action,
  children,
}: {
  title: string;
  description: ReactNode;
  danger?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`grid gap-4 border-t pt-8 first:border-t-0 first:pt-0 lg:grid-cols-[17rem_1fr] lg:gap-10 ${danger ? "border-red-100" : "border-line"}`}>
      <div>
        <h2 className={`text-sm font-semibold ${danger ? "text-red-700" : "text-ink"}`}>{title}</h2>
        <div className="mt-1 text-xs leading-relaxed text-ink-subtle">{description}</div>
        {action && <div className="mt-3">{action}</div>}
      </div>
      <div className="card min-w-0 p-5">{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-subtle">{hint}</span> : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-brand" : "bg-line"
      }`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

export function ReadOnlyNote() {
  return <p className="mb-4 rounded-md border border-line bg-elevated/60 px-3 py-2 text-xs text-ink-subtle">Only owners and admins can change these.</p>;
}
