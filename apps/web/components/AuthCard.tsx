import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./ui/Logo";

const POINTS = [
  "Lookalike domains, scam sites and fake accounts in one feed",
  "Evidence behind every score",
  "Takedown reports from your own mailbox, under your rules",
];

// Shared frame for the signed-out pages (sign in, reset password, accept invite, confirm email):
// a product panel beside the form on large screens, the form alone with the logo on small ones.
type AuthCardProps = { title: string; subtitle?: ReactNode; children: ReactNode };

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-shell lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px]" aria-hidden="true" />
        <Link href="/" className="relative w-fit" aria-label="Brand Monitor home">
          <Logo tone="light" />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">Find the sites impersonating your brand. Take them down.</h2>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3 text-sm text-shell-muted">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5fd3da]" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-shell-faint">Accounts are by invitation.</p>
      </aside>

      <main className="flex flex-col items-center justify-center bg-base px-4 py-10 sm:px-6">
        <Link href="/" className="mb-8 lg:hidden" aria-label="Brand Monitor home">
          <Logo />
        </Link>
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <div className="mt-2 text-sm leading-relaxed text-ink-subtle">{subtitle}</div>}
          <div className="card mt-6 p-6 sm:p-7">{children}</div>
        </div>
      </main>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}
