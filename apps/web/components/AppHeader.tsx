"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut, SignInButton, UserButton, OrganizationSwitcher } from "@clerk/nextjs";
import { NotificationBell } from "./NotificationBell";
import { ShieldIcon, HomeIcon, ListIcon, UsersIcon, FlagIcon } from "./icons";

const navLinkClass = "text-sm font-medium text-ink-subtle transition-colors hover:text-ink";
// Below `sm`, text nav links would otherwise force the header wider than the viewport
// (confirmed: the right-side icon cluster gets squeezed out of view entirely) -- icon-only
// on mobile, same links shown as text from `sm` up.
const navIconLinkClass = "text-ink-subtle transition-colors hover:text-ink sm:hidden";
const navTextLinkClass = `hidden sm:inline ${navLinkClass}`;

// The public scam-report form (/report/<token>) is seen by a brand's customers, not our
// users: no app nav, no sign-in button.
export function AppHeader() {
  const pathname = usePathname();
  if (pathname?.startsWith("/report/")) return null;

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-base/80 py-3 backdrop-blur">
      {/* Same mx-auto max-w-6xl px-6 shape as <main> below -- padding used to live on
          <header> itself, outside this box, so the nav centered within a narrower
          area than main did and the two never quite lined up at the edges. */}
      <nav className="mx-auto flex max-w-6xl items-center gap-3 px-6 sm:gap-7">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
            <ShieldIcon className="h-4 w-4" />
          </span>
          <span className="whitespace-nowrap font-semibold tracking-tight text-ink">Brand Monitor</span>
        </Link>
        <SignedIn>
          <Link href="/dashboard" className={navIconLinkClass} aria-label="Dashboard">
            <HomeIcon className="h-5 w-5" />
          </Link>
          <Link href="/dashboard" className={navTextLinkClass}>Dashboard</Link>
          <Link href="/threats" className={navIconLinkClass} aria-label="Threats">
            <ListIcon className="h-5 w-5" />
          </Link>
          <Link href="/threats" className={navTextLinkClass}>Threats</Link>
          <Link href="/team" className={navIconLinkClass} aria-label="Team">
            <UsersIcon className="h-5 w-5" />
          </Link>
          <Link href="/team" className={navTextLinkClass}>Team</Link>
          <Link href="/reports" className={navIconLinkClass} aria-label="Public reports">
            <FlagIcon className="h-5 w-5" />
          </Link>
          <Link href="/reports" className={navTextLinkClass}>Reports</Link>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-5">
            <NotificationBell />
            <div className="hidden h-5 w-px shrink-0 bg-line sm:block" />
            {/* A long org name doesn't shrink or truncate on its own inside Clerk's
                trigger button -- the appearance.elements className hook below is
                Clerk's documented way to constrain it, but confirmed unreliable in
                practice (still overflowed past the header in a real signed-in
                session). The outer div's own hard max-width + overflow-hidden is
                the actual guarantee: plain Tailwind on an element this code fully
                controls, not dependent on Clerk's internal class plumbing. Narrower
                cap below `sm` to leave room for the icon links + avatar. */}
            <div className="max-w-[60px] shrink-0 overflow-hidden sm:max-w-[180px]">
              <OrganizationSwitcher
                hidePersonal
                appearance={{
                  variables: { colorPrimary: "#5b4fe0" },
                  elements: {
                    organizationSwitcherTrigger: "max-w-[60px] sm:max-w-[180px]",
                    organizationPreviewTextContainer: "truncate",
                  },
                }}
                afterCreateOrganizationUrl="/dashboard"
                afterSelectOrganizationUrl="/dashboard"
              />
            </div>
            <UserButton />
          </div>
        </SignedIn>
        <SignedOut>
          <div className="ml-auto">
            <SignInButton mode="modal" />
          </div>
        </SignedOut>
      </nav>
    </header>
  );
}
