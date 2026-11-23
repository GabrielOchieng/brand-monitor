"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "../lib/session";
import { NotificationBell } from "./NotificationBell";
import { OrgSwitcher, UserMenu } from "./HeaderMenus";
import { ShieldIcon, HomeIcon, ListIcon, FlagIcon, MessageIcon, SettingsIcon } from "./icons";

const navLinkClass = "text-sm font-medium transition-colors";
// Below `sm`, text nav links would otherwise force the header wider than the viewport
// (confirmed: the right-side icon cluster gets squeezed out of view entirely) -- icon-only
// on mobile, same links shown as text from `sm` up.
const navIconLinkClass = "transition-colors lg:hidden";
const navTextLinkClass = `hidden lg:inline ${navLinkClass}`;

const NAV = [
  { href: "/dashboard", label: "Overview", Icon: HomeIcon },
  { href: "/threats", label: "Threats", Icon: ListIcon },
  { href: "/mentions", label: "Mentions", Icon: MessageIcon },
  { href: "/reports", label: "Reports", Icon: FlagIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

// The public scam-report form (/report/<token>) is seen by a brand's customers, not our
// users: no header at all. Sign-in pages show the logo only.
export function AppHeader() {
  const pathname = usePathname();
  const { me } = useSession();
  if (pathname?.startsWith("/report/")) return null;

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-base/80 py-3 backdrop-blur">
      {/* Same mx-auto max-w-7xl px-4 sm:px-6 shape as <main> below -- padding used to live on
          <header> itself, outside this box, so the nav centered within a narrower
          area than main did and the two never quite lined up at the edges. */}
      <nav className="mx-auto flex max-w-7xl items-center gap-4 px-4 sm:px-6 lg:gap-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <ShieldIcon className="h-4 w-4" />
          </span>
          <span className="whitespace-nowrap font-semibold tracking-tight text-ink">Brand Monitor</span>
        </Link>
        {me && (
          <>
          {NAV.map(({ href, label, Icon }) => {
            // The current section is marked: a finding page counts as Threats.
            const active = pathname === href || pathname?.startsWith(`${href}/`);
            const tone = active ? "text-ink" : "text-ink-subtle hover:text-ink";
            return (
              <span key={href} className="contents">
                <Link href={href} className={`${navIconLinkClass} ${tone}`} aria-label={label} aria-current={active ? "page" : undefined}>
                  <Icon className="h-5 w-5" />
                </Link>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`${navTextLinkClass} ${tone} relative py-1 after:absolute after:inset-x-0 after:-bottom-[13px] after:h-0.5 after:rounded-full ${active ? "after:bg-brand" : "after:bg-transparent"}`}
                >
                  {label}
                </Link>
              </span>
            );
          })}
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-5">
            <NotificationBell />
            <div className="hidden h-5 w-px shrink-0 bg-line sm:block" />
            {/* Long org names truncate; narrower cap below `sm` to leave room for the icon
                links and the avatar. */}
            <div className="max-w-[90px] shrink-0 sm:max-w-[180px]">
              <OrgSwitcher />
            </div>
            <UserMenu />
          </div>
          </>
        )}
      </nav>
    </header>
  );
}
