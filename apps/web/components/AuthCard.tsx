import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./ui/Logo";
import { SeverityTag } from "./threat/atoms";

const POINTS = ["Lookalike domains, scam sites and fake accounts in one queue", "The evidence behind every score", "Takedown reports from your own mailbox, under your rules"];

// Example rows for the side panel: clearly fictional domains, never real findings.
const ROWS: Array<[string, string, string]> = [
  ["critical", "yourbrand-support.example", "Login form · 2 days old"],
  ["high", "yourbrnad.example", "Typo of your domain"],
  ["medium", "pay-yourbrand.example", "Parked · watching"],
];

// Shared frame for the signed-out pages (sign in, reset password, accept invite, confirm email):
// a product panel beside the form on large screens, the form alone with the logo on small ones.
type AuthCardProps = { title: string; subtitle?: ReactNode; children: ReactNode };

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-sunk lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Link href="/" className="relative w-fit" aria-label="Brand Monitor home">
          <Logo />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-balance">Find the sites impersonating your brand. Take them down.</h2>
          <ul className="mt-6 flex flex-col gap-2.5">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3 text-[13.5px] text-muted-foreground">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
          <figure className="mt-8 overflow-hidden rounded-md border border-border-strong bg-card" aria-label="Example of the threat queue">
            {ROWS.map(([sev, d, why]) => (
              <div key={d} className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0">
                <SeverityTag severity={sev} className="w-[74px] shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12.5px]">{d}</span>
                  <span className="block truncate text-[11px] text-subtle">{why}</span>
                </span>
              </div>
            ))}
          </figure>
        </div>
        <p className="relative text-xs text-subtle">Accounts are by invitation.</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-6">
        <Link href="/" className="mb-8 lg:hidden" aria-label="Brand Monitor home">
          <Logo />
        </Link>
        <div className="w-full max-w-sm">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{title}</h1>
          {subtitle && <div className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{subtitle}</div>}
          <div className="mt-6 rounded-md border border-border bg-card p-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-sev-critical/40 bg-sev-critical/10 px-3 py-2 text-[13px] text-sev-critical">
      {message}
    </p>
  );
}
