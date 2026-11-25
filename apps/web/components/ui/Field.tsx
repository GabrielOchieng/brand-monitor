import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const control =
  "w-full min-w-0 rounded-md border border-input bg-background text-[13px] text-foreground placeholder:text-subtle focus:border-transparent focus:outline-2 focus:-outline-offset-1 focus:outline-primary disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-sev-critical";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(function Input({ className, mono, ...props }, ref) {
  return <input ref={ref} className={cn(control, "h-8.5 px-2.5", mono && "font-mono text-[12.5px]", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(function Textarea({ className, mono, ...props }, ref) {
  return <textarea ref={ref} className={cn(control, "px-2.5 py-2 leading-relaxed", mono && "font-mono text-[12.5px]", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(control, "h-8.5 px-2", className)} {...props} />;
});

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[12.5px] font-medium text-muted-foreground", className)} {...props} />;
}

type FieldProps = { label: ReactNode; htmlFor: string; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string };

// Label, control, then a hint or an error under it.
export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-sev-critical">{error}</p> : hint ? <p className="text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

type FormSectionProps = { title: ReactNode; description?: ReactNode; children: ReactNode; danger?: boolean; className?: string };

// Settings layout: what this group is about on the left, its controls on the right (stacked on mobile).
export function FormSection({ title, description, children, danger, className }: FormSectionProps) {
  return (
    <div className={cn("grid gap-3 border-t border-border py-5 first:border-t-0 first:pt-1 lg:grid-cols-[minmax(200px,280px)_minmax(0,1fr)] lg:gap-6", className)}>
      <div>
        <h3 className={cn("text-[13.5px] font-semibold", danger && "text-sev-critical")}>{title}</h3>
        {description && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="flex min-w-0 max-w-[560px] flex-col gap-3">{children}</div>
    </div>
  );
}
