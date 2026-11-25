"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { PageHeader } from "../../components/ui/PageHeader";

const GROUPS: Array<{ label: string; items: Array<{ href: string; label: string; exact?: boolean }> }> = [
  {
    label: "Notifications",
    items: [
      { href: "/settings/alerts", label: "Alerts" },
      { href: "/settings/webhook", label: "Webhook" },
    ],
  },
  {
    label: "Takedown reporting",
    items: [
      { href: "/settings/automatic-reporting", label: "Setup", exact: true },
      { href: "/settings/automatic-reporting/sending", label: "Sending rules" },
      { href: "/settings/automatic-reporting/sender", label: "Sender mailbox" },
      { href: "/settings/automatic-reporting/authorization", label: "Authorization" },
      { href: "/settings/report-templates", label: "Report templates" },
      { href: "/settings/report-recipients", label: "Report recipients" },
      { href: "/settings/automatic-reporting/cloudflare", label: "Cloudflare" },
      { href: "/settings/automatic-reporting/history", label: "History" },
    ],
  },
];

// Settings: a section menu (scrolling chips on phones) beside one section's own page.
// Brands and Team have their own pages in the main navigation.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const active = (href: string, exact?: boolean): boolean => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <div>
      <PageHeader
        title="Settings"
        description={
          <>
            Alerts and takedown reporting for the whole organization. Brands and what&apos;s monitored are under{" "}
            <Link href="/brands" className="text-primary hover:underline">
              Brands
            </Link>
            , people under{" "}
            <Link href="/team" className="text-primary hover:underline">
              Team
            </Link>
            .
          </>
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6">
        <nav
          aria-label="Settings sections"
          className="flex gap-1 overflow-x-auto border-b border-border pb-2 [scrollbar-width:none] lg:sticky lg:top-[calc(52px+20px)] lg:flex-col lg:gap-3.5 lg:overflow-visible lg:border-b-0 lg:pb-0 [&::-webkit-scrollbar]:hidden"
        >
          {GROUPS.map((g) => (
            <div key={g.label} className="flex gap-1 lg:flex-col lg:gap-px">
              <div className="eyebrow hidden px-2.5 pb-1 text-[10px] lg:block">{g.label}</div>
              {g.items.map((i) => {
                const on = active(i.href, i.exact);
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "whitespace-nowrap rounded-md border border-border px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground lg:border-0",
                      on && "border-primary/50 bg-primary-soft text-foreground lg:bg-raised lg:shadow-[inset_2px_0_0_var(--primary)]"
                    )}
                  >
                    {i.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
