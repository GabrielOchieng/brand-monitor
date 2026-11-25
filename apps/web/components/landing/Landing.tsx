import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "../ui/Logo";

// The public website (one page). Everything it claims is something the product does today
// (README "Features"); there are no customer logos, testimonials or made-up numbers. The product
// visual is an illustration with clearly fictional example domains.

function RequestAccess({ email, className = "" }: { email: string | null; className?: string }) {
  if (!email) return null;
  const href = `mailto:${email}?subject=${encodeURIComponent("Brand Monitor: request access")}`;
  return (
    <a href={href} className={`btn-primary px-4 py-2.5 ${className}`}>
      Request access
    </a>
  );
}

function Section({ id, eyebrow, title, intro, children, tone = "light" }: { id?: string; eyebrow: string; title: string; intro?: ReactNode; children: ReactNode; tone?: "light" | "muted" }) {
  return (
    <section id={id} className={`scroll-mt-16 border-t border-line ${tone === "muted" ? "bg-base" : "bg-card"}`}>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">{eyebrow}</div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h2>
          {intro && <p className="mt-3 text-base leading-relaxed text-ink-subtle">{intro}</p>}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

// A static rendering of the product's threat feed, with example data.
function ProductIllustration() {
  const rows = [
    { d: "yourbrand-support.example", sev: "Critical", tone: "bg-red-500/15 text-red-300 ring-red-400/30", why: "Login form · registered 2 days ago", status: "Report queued" },
    { d: "yourbrnad.example", sev: "High", tone: "bg-orange-500/15 text-orange-300 ring-orange-400/30", why: "Typo of your domain · payment page", status: "Investigating" },
    { d: "pay-yourbrand.example", sev: "High", tone: "bg-orange-500/15 text-orange-300 ring-orange-400/30", why: "Shares a phone number with a known scam", status: "New" },
    { d: "yourbrand.example.net", sev: "Medium", tone: "bg-amber-500/15 text-amber-200 ring-amber-400/30", why: "Parked lookalike · watching", status: "Watching" },
  ];
  return (
    <figure className="relative" aria-label="Illustration of the threat feed with example data">
      <div className="absolute -inset-6 -z-10 rounded-[28px] bg-[radial-gradient(ellipse_at_top,rgba(95,211,218,0.18),transparent_65%)]" aria-hidden="true" />
      <div className="overflow-hidden rounded-xl border border-shell-line bg-shell-raised shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between border-b border-shell-line px-4 py-3">
          <div className="text-xs font-medium text-shell-ink">Threats · open</div>
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-shell-line" />
            <span className="h-2 w-2 rounded-full bg-shell-line" />
            <span className="h-2 w-2 rounded-full bg-shell-line" />
          </div>
        </div>
        <ul className="divide-y divide-shell-line">
          {rows.map((r) => (
            <li key={r.d} className="flex items-center gap-3 px-4 py-3">
              <span className={`w-16 shrink-0 rounded-sm px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide ring-1 ${r.tone}`}>{r.sev}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px] text-shell-ink">{r.d}</div>
                <div className="truncate text-[11px] text-shell-muted">{r.why}</div>
              </div>
              <span className="hidden shrink-0 text-[11px] text-shell-faint sm:inline">{r.status}</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-shell-line bg-shell px-4 py-3 text-[11px] text-shell-muted">
          <span className="font-mono text-[#7fe3e9]">[BM-7KQ2X9TD]</span> takedown report to the registrar · sent from your mailbox after the veto window
        </div>
      </div>
      <figcaption className="mt-3 text-center text-[11px] text-shell-faint">Illustration with example domains</figcaption>
    </figure>
  );
}

const SOURCES = ["Certificate Transparency logs", "Newly registered domains", "App Store and Google Play", "Phishing feeds", "Social media and web search", "Reports from your customers"];

const STEPS = [
  {
    n: "01",
    title: "Detect",
    text: "New lookalikes of your domains and brand names are picked up from certificate logs, daily newly-registered-domain lists, app stores, phishing feeds, social search, and a report form you give your customers.",
  },
  {
    n: "02",
    title: "Investigate",
    text: "Each one is scanned and scored on evidence: how close the name is, login and payment forms, visual similarity to your real site, contact details shared with other scams, registration age and changes. Analysts triage in one feed.",
  },
  {
    n: "03",
    title: "Take down",
    text: "Reports to the registrar, host and national CERT are written from your templates with the evidence filled in, sent from your own mailbox under your rules, followed up, and tracked until the site is down.",
  },
];

const CAPABILITIES = [
  { t: "Lookalike domains", d: "Typos, character swaps, homoglyphs and your brand words paired with others, across hundreds of top-level domains." },
  { t: "Evidence-based scoring", d: "Every score shows its reasons: login or payment forms, visual and favicon matches, shared phone numbers and payment accounts." },
  { t: "Registration intelligence", d: "Registrar, abuse contacts, hosting provider, and alerts when a dormant domain changes or a taken-down site comes back." },
  { t: "Takedown workflow", d: "Report templates, a contact book of registrars and hosts, approval or veto windows, follow-ups, escalation and results per registrar." },
  { t: "Impersonation beyond the web", d: "Fake app listings and social accounts are tracked too, with the platform's own reporting route for each." },
  { t: "Alerts where you work", d: "Email, in-app and signed webhooks, by severity, for new sites going live, registration changes and reactivations." },
];

const TRUST = [
  { t: "Your data stays yours", d: "Every organization is isolated at the database level (row-level security), not just in the app." },
  { t: "Nothing sent without your rules", d: "Automatic reports start in shadow mode, go through an approval or veto window, and can be stopped at once." },
  { t: "Reports from your own mailbox", d: "Registrars see your domain and replies come back to your team, through Microsoft 365, Google Workspace or your mail server." },
  { t: "Accountable by design", d: "Roles per member, two-factor sign-in, and a history of every setting change and every report sent." },
];

type LandingProps = { contactEmail: string | null };

export function Landing({ contactEmail }: LandingProps) {
  return (
    <div className="min-h-screen bg-card">
      <header className="sticky top-0 z-20 border-b border-shell-line bg-shell/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="Brand Monitor home">
            <Logo tone="light" />
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-6 text-sm text-shell-muted md:flex">
            <a href="#how" className="hover:text-shell-ink">
              How it works
            </a>
            <a href="#capabilities" className="hover:text-shell-ink">
              Capabilities
            </a>
            <a href="#security" className="hover:text-shell-ink">
              Security
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="btn rounded-md px-3 py-2 text-shell-ink hover:bg-shell-raised">
              Sign in
            </Link>
            <RequestAccess email={contactEmail} className="hidden sm:inline-flex" />
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-shell">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[48px_48px]" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-shell-line bg-shell-raised px-3 py-1 text-xs text-shell-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5fd3da]" aria-hidden="true" />
              Brand protection and takedown platform
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl">
              Find the sites impersonating your brand. <span className="text-[#7fe3e9]">Take them down.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-shell-muted sm:text-lg">
              Brand Monitor watches for lookalike domains, phishing sites and fake accounts that use your name, shows the evidence behind each one, and prepares the takedown
              reports for your team.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <RequestAccess email={contactEmail} />
              <Link href="/login" className="btn rounded-md border border-shell-line px-4 py-2.5 text-shell-ink hover:bg-shell-raised">
                Sign in
              </Link>
            </div>
            <p className="mt-4 text-xs text-shell-faint">Accounts are by invitation. {contactEmail ? "Ask for access and we'll set up your organization." : "Ask your administrator for an invite."}</p>
          </div>
          <ProductIllustration />
        </div>
        <div className="relative border-t border-shell-line bg-shell-raised/50">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 text-xs text-shell-muted sm:px-6">
            <span className="font-semibold uppercase tracking-[0.14em] text-shell-faint">Watches</span>
            {SOURCES.map((s) => (
              <span key={s} className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-shell-faint" aria-hidden="true" />
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      <Section id="how" eyebrow="How it works" title="From first sighting to takedown, in one place" intro="Impersonation sites go up fast and come back after takedowns. Brand Monitor keeps watching each one until it's gone, and tells you when it returns.">
        <ol className="grid gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="relative rounded-lg border border-line bg-card p-6">
              <div className="font-mono text-xs font-medium text-brand">{s.n}</div>
              <h3 className="mt-2 text-lg font-semibold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-subtle">{s.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="capabilities" tone="muted" eyebrow="Capabilities" title="Built for the way impersonation actually happens">
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <div key={c.t} className="bg-card p-6">
              <h3 className="text-sm font-semibold text-ink">{c.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-subtle">{c.d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="security" eyebrow="Security" title="Made for security and legal teams">
        <div className="grid gap-6 sm:grid-cols-2">
          {TRUST.map((c) => (
            <div key={c.t} className="flex gap-4">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
                  <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-ink">{c.t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-subtle">{c.d}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <section className="bg-shell">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white">See who is using your brand.</h2>
            <p className="mt-2 text-sm text-shell-muted">Set up your brand, keywords and official accounts, and the first findings arrive within hours.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <RequestAccess email={contactEmail} />
            <Link href="/login" className="btn rounded-md border border-shell-line px-4 py-2.5 text-shell-ink hover:bg-shell-raised">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-shell-line bg-shell">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-xs text-shell-faint sm:px-6">
          <Logo tone="light" />
          <div className="flex flex-wrap gap-5">
            <Link href="/login" className="hover:text-shell-ink">
              Sign in
            </Link>
            {contactEmail && (
              <a href={`mailto:${contactEmail}`} className="hover:text-shell-ink">
                Contact
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
