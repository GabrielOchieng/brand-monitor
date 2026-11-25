import { cn } from "../../lib/cn";

// The product mark: a shield with a check, in the theme's primary colour.
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-7 shrink-0 place-items-center rounded-sm bg-primary text-primary-foreground", className)} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-[17px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    </span>
  );
}

// tone is kept for older call sites; the theme decides the colours now.
type LogoProps = { tone?: "dark" | "light"; className?: string };

export function Logo({ className }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-foreground">Brand Monitor</span>
    </span>
  );
}
