import type { ReactNode } from "react";

// One settings panel. The settings page shows a single one at a time, chosen in its
// sidebar, so this is a heading, a short explanation and the controls in a card.
export function Section({
  title,
  description,
  danger,
  children,
}: {
  title: string;
  description: ReactNode;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className={`text-lg font-semibold tracking-tight ${danger ? "text-red-700" : "text-ink"}`}>{title}</h2>
      <div className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-subtle">{description}</div>
      <div className={`card mt-5 min-w-0 p-5 sm:p-6 ${danger ? "border-red-200" : ""}`}>{children}</div>
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
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}

export function ReadOnlyNote() {
  return <p className="mb-5 rounded-md border border-line bg-elevated/60 px-3 py-2 text-xs text-ink-subtle">Only owners and admins can change these settings.</p>;
}
