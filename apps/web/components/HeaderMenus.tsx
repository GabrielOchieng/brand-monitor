"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "../lib/session";
import { CheckIcon, ChevronDownIcon } from "./icons";

// A button plus a panel that closes on outside click or Escape.
function Dropdown({ label, trigger, children }: { label: string; trigger: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" aria-label={label} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-center gap-1.5">
        {trigger}
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 top-full z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] p-1">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const itemClass = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-ink-muted hover:bg-elevated hover:text-ink";

export function OrgSwitcher() {
  const { me, orgId, switchOrg } = useSession();
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const active = me.organizations.find((o) => o.id === orgId);
  return (
    <Dropdown
      label="Switch organization"
      trigger={
        <>
          <span className="truncate text-sm font-medium text-ink">{active?.name ?? "Choose organization"}</span>
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
        </>
      }
    >
      {(close) => (
        <>
          <div className="label px-2.5 pb-1 pt-1.5">Organizations</div>
          {me.organizations.map((o) => (
            <button
              key={o.id}
              role="menuitem"
              className={itemClass}
              onClick={async () => {
                close();
                if (o.id === orgId) return;
                setError(null);
                try {
                  await switchOrg(o.id);
                } catch (err: any) {
                  setError(err.message);
                }
              }}
            >
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="shrink-0 text-xs capitalize text-ink-faint">{o.role}</span>
              {o.id === orgId && <CheckIcon className="h-4 w-4 shrink-0 text-brand" />}
            </button>
          ))}
          {error && <p className="px-2.5 py-1 text-xs text-red-600">{error}</p>}
        </>
      )}
    </Dropdown>
  );
}

export function UserMenu() {
  const { me, signOut } = useSession();
  if (!me) return null;
  const initial = (me.user.name || me.user.email).slice(0, 1).toUpperCase();
  return (
    <Dropdown
      label="Account menu"
      trigger={<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{initial}</span>}
    >
      {(close) => (
        <>
          <div className="px-2.5 py-2">
            {me.user.name && <div className="truncate text-sm font-medium text-ink">{me.user.name}</div>}
            <div className="truncate text-xs text-ink-subtle">{me.user.email}</div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link href="/account" role="menuitem" className={itemClass} onClick={close}>
            Account and security
          </Link>
          {me.platformRole && (
            <Link href="/admin" role="menuitem" className={itemClass} onClick={close}>
              Admin panel
            </Link>
          )}
          <button
            role="menuitem"
            className={itemClass}
            onClick={() => {
              close();
              signOut();
            }}
          >
            Sign out
          </button>
        </>
      )}
    </Dropdown>
  );
}
