// The product mark: a shield with a radar sweep (monitoring + protection), drawn inline.
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0d6c76" />
      <path d="M16 6.5 8.5 9.4v5.9c0 4.7 3.2 8.4 7.5 10.2 4.3-1.8 7.5-5.5 7.5-10.2V9.4L16 6.5Z" fill="none" stroke="#e6f6f7" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M16 16 20.6 11.4" stroke="#7fe3e9" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12.2 16a3.8 3.8 0 0 1 3.8-3.8" fill="none" stroke="#e6f6f7" strokeWidth="1.4" strokeLinecap="round" opacity=".7" />
      <circle cx="16" cy="16" r="1.4" fill="#7fe3e9" />
    </svg>
  );
}

type LogoProps = { tone?: "dark" | "light"; className?: string };

export function Logo({ tone = "dark", className = "" }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className={`whitespace-nowrap text-[15px] font-semibold tracking-tight ${tone === "light" ? "text-shell-ink" : "text-ink"}`}>Brand Monitor</span>
    </span>
  );
}
