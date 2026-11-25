"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, Building2, Check, ChevronDown, LogOut, Moon, Search, ShieldCheck, Sun, UserRound, Users } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useBrands } from "../../lib/brand";
import { useSession } from "../../lib/session";
import { timeAgo } from "../../lib/format";
import { cn } from "../../lib/cn";
import { useTheme } from "../theme/theme";
import { Button, Kbd } from "../ui/Button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "../ui/Menu";
import { LogoMark } from "./Sidebar";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function BrandSwitcher() {
  const { brands, selected, select } = useBrands();
  if (!brands || brands.length === 0 || !selected) return null;
  const trigger = (
    <span className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-raised py-1 pl-1.5 pr-2 text-[13px] font-medium">
      <span className="grid size-5 shrink-0 place-items-center rounded-sm bg-primary-soft text-[10px] font-bold text-primary">{initials(selected.name)}</span>
      <span className="truncate">{selected.name}</span>
      <span className="hidden truncate font-mono text-xs font-normal text-subtle md:inline">{selected.primaryDomain}</span>
      {brands.length > 1 && <ChevronDown className="size-4 shrink-0 text-subtle" aria-hidden="true" />}
    </span>
  );
  if (brands.length === 1) return <div className="min-w-0">{trigger}</div>;
  return (
    <Menu>
      <MenuTrigger className="min-w-0 rounded-md" aria-label={`Brand: ${selected.name}. Switch brand`}>
        {trigger}
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Brands</MenuLabel>
        {brands.map((b) => (
          <MenuItem key={b.id} onSelect={() => select(b.id)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground">{b.name}</span>
              <span className="block truncate font-mono text-xs text-subtle">{b.primaryDomain}</span>
            </span>
            {b.id === selected.id && <Check className="text-primary" />}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

interface NotificationItem {
  id: string;
  findingId: string | null;
  link: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsButton() {
  const { isLoaded, orgId, me } = useSession();
  const [data, setData] = useState<{ notifications: NotificationItem[]; unreadCount: number } | null>(null);
  const readOnly = !!me?.adminView;

  const poll = useCallback(async () => {
    try {
      setData(await apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>("/api/notifications"));
    } catch {
      // Notifications are non-critical: a failed poll just skips this tick.
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !orgId) return;
    poll();
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, [isLoaded, orgId, poll]);

  if (!isLoaded || !orgId) return null;
  const unread = data?.unreadCount ?? 0;
  const recent = data?.notifications.slice(0, 6) ?? [];

  async function markAllRead() {
    await apiFetch("/api/notifications/read-all", { method: "POST" }).catch(() => undefined);
    poll();
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 grid h-[15px] min-w-[15px] place-items-center rounded-full border-2 border-card bg-sev-critical px-0.5 text-[9.5px] font-bold leading-none text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          <h2 className="text-[13px] font-semibold">Notifications</h2>
          {!readOnly && unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-[13px] text-subtle">Nothing new.</p>
        ) : (
          <ul>
            {recent.map((n) => (
              <li key={n.id} className="grid grid-cols-[8px_1fr] gap-2.5 border-b border-border px-3.5 py-2.5 text-[13px] last:border-b-0">
                <span className={cn("mt-1.5 size-2 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-hidden="true" />
                <div className="min-w-0">
                  {n.link || n.findingId ? (
                    <Link href={n.link ?? `/threats/${n.findingId}`} className="hover:text-primary">
                      {n.message}
                    </Link>
                  ) : (
                    n.message
                  )}
                  <time className="block font-mono text-[11.5px] text-subtle">{timeAgo(n.createdAt)}</time>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link href="/notifications" className="block border-t border-border px-3.5 py-2 text-center text-xs text-primary hover:underline">
          All notifications
        </Link>
      </PopoverContent>
    </Popover>
  );
}

export function ThemeButton() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

export function UserMenu() {
  const { me, orgId, switchOrg, signOut } = useSession();
  const { theme, toggle } = useTheme();
  if (!me) return null;
  const orgName = me.adminView ? `${me.adminView.name} (viewing)` : me.organizations.find((o) => o.id === orgId)?.name;
  const role = me.organizations.find((o) => o.id === orgId)?.role;
  return (
    <Menu>
      <MenuTrigger
        className="ml-1 grid size-7 place-items-center rounded-full border border-border-strong bg-raised text-[11px] font-semibold text-muted-foreground hover:text-foreground"
        aria-label="Account menu"
      >
        {initials(me.user.name || me.user.email)}
      </MenuTrigger>
      <MenuContent className="w-64">
        <div className="border-b border-border px-2.5 pb-2.5 pt-1.5 text-[13px]">
          {me.user.name && <div className="truncate font-medium">{me.user.name}</div>}
          <div className="truncate font-mono text-xs text-subtle">{me.user.email}</div>
          {orgName && (
            <div className="mt-1 truncate text-xs text-subtle">
              {role ? <span className="capitalize">{role}</span> : null}
              {role ? " · " : ""}
              {orgName}
            </div>
          )}
        </div>
        <MenuItem asChild>
          <Link href="/account">
            <UserRound />
            Account and security
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link href="/team">
            <Users />
            Team
          </Link>
        </MenuItem>
        {me.platformRole && (
          <MenuItem asChild>
            <Link href="/admin">
              <ShieldCheck />
              Admin panel
            </Link>
          </MenuItem>
        )}
        <MenuItem onSelect={(e) => { e.preventDefault(); toggle(); }}>
          {theme === "dark" ? <Sun /> : <Moon />}
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </MenuItem>
        {me.organizations.length > 1 && !me.adminView && (
          <>
            <MenuSeparator />
            <MenuLabel>Organizations</MenuLabel>
            {me.organizations.map((o) => (
              <MenuItem key={o.id} onSelect={() => o.id !== orgId && switchOrg(o.id)}>
                <Building2 />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.id === orgId && <Check className="text-primary" />}
              </MenuItem>
            ))}
          </>
        )}
        <MenuSeparator />
        <MenuItem onSelect={() => signOut()}>
          <LogOut />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function TopBar({ onSearch }: { onSearch: () => void }) {
  return (
    <header className="sticky top-[env(safe-area-inset-top)] z-30 flex h-[52px] items-center gap-2.5 border-b border-border bg-card pl-[max(16px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))] lg:pl-5 lg:pr-[max(20px,env(safe-area-inset-right))]">
      <Link href="/dashboard" className="lg:hidden" aria-label="Brand Monitor, overview">
        <LogoMark />
      </Link>
      <BrandSwitcher />
      <button
        type="button"
        onClick={onSearch}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-left text-[13px] text-subtle hover:border-border-strong md:max-w-[460px]"
        aria-label="Search threats and pages"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 truncate sm:inline">Search threats, domains, pages</span>
        <Kbd className="ml-auto hidden md:inline">Ctrl K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <span className="hidden md:inline-flex">
          <ThemeButton />
        </span>
        <NotificationsButton />
        <UserMenu />
      </div>
    </header>
  );
}
