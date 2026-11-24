"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useSession } from "../lib/session";
import { NotificationBell } from "./NotificationBell";
import { OrgSwitcher, UserMenu } from "./HeaderMenus";
import { PausedBanner } from "./PausedBanner";
import { AdminViewBanner } from "./AdminViewBanner";
import { Logo } from "./ui/Logo";
import { ActivityIcon, FlagIcon, HomeIcon, ListIcon, MessageIcon, SettingsIcon, ShieldIcon, UsersIcon } from "./icons";

type Item = { href: string; label: string; Icon: ComponentType<{ className?: string }>; match?: string[] };

// The app's information architecture: what people watch, what they act on, what they set up.
const GROUPS: Array<{ label: string; items: Item[] }> = [
  {
    label: "Monitor",
    items: [
      { href: "/dashboard", label: "Overview", Icon: HomeIcon },
      { href: "/threats", label: "Threats", Icon: ListIcon },
      { href: "/mentions", label: "Mentions", Icon: MessageIcon },
    ],
  },
  {
    label: "Respond",
    items: [
      { href: "/takedowns", label: "Takedowns", Icon: ShieldIcon },
      { href: "/reports", label: "Public reports", Icon: FlagIcon },
      { href: "/notifications", label: "Notifications", Icon: ActivityIcon },
    ],
  },
  {
    label: "Configure",
    items: [
      { href: "/settings", label: "Settings", Icon: SettingsIcon, match: ["/team"] },
      { href: "/account", label: "Account & security", Icon: UsersIcon },
    ],
  },
];

// Pages that aren't part of the signed-in app: the landing page, sign-in flows and the public
// scam-report form. They bring their own layout.
const AUTH_PATHS = ["/login", "/forgot-password", "/reset-password", "/invite", "/confirm-email"];

export function isBarePath(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/" || pathname.startsWith("/report/") || AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

type NavProps = { pathname: string; onNavigate?: () => void };

function NavLinks({ pathname, onNavigate }: NavProps) {
  const { me } = useSession();
  const groups: Array<{ label: string; items: Item[] }> = me?.platformRole ? [...GROUPS, { label: "Platform", items: [{ href: "/admin", label: "Admin panel", Icon: UsersIcon }] }] : GROUPS;
  return (
    <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-shell-faint">{g.label}</div>
          <ul className="mt-2 space-y-0.5">
            {g.items.map(({ href, label, Icon, match }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`) || (match ?? []).some((m) => pathname.startsWith(m));
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      active ? "bg-shell-raised font-medium text-white" : "text-shell-muted hover:bg-shell-raised/60 hover:text-shell-ink"
                    }`}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[#5fd3da]" aria-hidden="true" />}
                    <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-[#7fe3e9]" : "text-shell-faint group-hover:text-shell-muted"}`} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarContent({ pathname, onNavigate }: NavProps) {
  return (
    <div className="flex h-full flex-col bg-shell">
      <div className="flex h-14 shrink-0 items-center border-b border-shell-line px-5">
        <Link href="/dashboard" onClick={onNavigate} aria-label="Brand Monitor, overview">
          <Logo tone="light" />
        </Link>
      </div>
      <NavLinks pathname={pathname} onNavigate={onNavigate} />
      <div className="border-t border-shell-line px-5 py-4 text-[11px] leading-relaxed text-shell-faint">Brand protection for lookalike domains, scam sites and impersonation.</div>
    </div>
  );
}

// The signed-in app: sidebar (a drawer on small screens), a slim top bar, the page.
type AppFrameProps = { children: ReactNode };

export function AppFrame({ children }: AppFrameProps) {
  const pathname = usePathname() ?? "";
  const [drawer, setDrawer] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Close the drawer on navigation.
  useEffect(() => setDrawer(false), [pathname]);

  // While open: focus moves into the drawer, Tab stays inside it, Escape closes it; on close,
  // focus goes back to the menu button.
  useEffect(() => {
    if (!drawer) return;
    const button = menuButton.current;
    const focusables = () => Array.from(panel.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? []);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      button?.focus();
    };
  }, [drawer]);

  if (isBarePath(pathname)) return <>{children}</>;

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-pop">
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <SidebarContent pathname={pathname} />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-shell/60 backdrop-blur-[1px]" aria-label="Close navigation" onClick={() => setDrawer(false)} />
          <div ref={panel} className="absolute inset-y-0 left-0 w-64 max-w-[85vw] shadow-pop">
            <SidebarContent pathname={pathname} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="flex min-h-screen min-w-0 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button ref={menuButton} className="-ml-1 rounded-md p-1.5 text-ink-subtle hover:bg-elevated hover:text-ink lg:hidden" aria-label="Open navigation" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          <Link href="/dashboard" className="lg:hidden" aria-label="Brand Monitor, overview">
            <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
          </Link>
          <div className="min-w-0 max-w-[55vw] sm:max-w-xs">
            <OrgSwitcher />
          </div>
          <div className="ml-auto flex items-center gap-4">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <AdminViewBanner />
        <PausedBanner />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
