"use client";

import Link from "next/link";
import { useSession } from "../../lib/session";
import { cn } from "../../lib/cn";
import { ADMIN_GROUP, NAV, isActive, type NavGroup } from "./nav";

export function useNavGroups(): NavGroup[] {
  const { me } = useSession();
  return me?.platformRole ? [...NAV, ADMIN_GROUP] : NAV;
}

export function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const groups = useNavGroups();
  return (
    <nav aria-label="Main" className="flex flex-col gap-[18px]">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-px">
          <div className="eyebrow px-2.5 pb-1.5 text-[10px]">{g.label}</div>
          {g.items.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] text-muted-foreground hover:bg-hover hover:text-foreground",
                  active && "bg-primary-soft text-foreground [&_svg]:text-primary"
                )}
              >
                <item.Icon className="size-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-6 shrink-0 place-items-center rounded-sm bg-primary text-primary-foreground", className)} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    </span>
  );
}

export function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[228px] flex-col border-r border-border bg-sunk pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] lg:flex">
      <Link href="/dashboard" className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border px-4" aria-label="Brand Monitor, overview">
        <LogoMark />
        <span className="leading-tight">
          <span className="block text-[14px] font-semibold tracking-tight">Brand Monitor</span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.06em] text-subtle">Console</span>
        </span>
      </Link>
      <div className="flex-1 overflow-y-auto px-2.5 py-3.5">
        <NavList pathname={pathname} />
      </div>
    </aside>
  );
}
