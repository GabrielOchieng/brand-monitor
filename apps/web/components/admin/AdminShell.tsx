"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, apiFetch } from "../../lib/api";
import { useSession } from "../../lib/session";
import { LoadingRegion, SkeletonList } from "../Skeleton";

const TABS = [
  { href: "/admin", label: "Organizations" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/contacts", label: "Contact book" },
  { href: "/admin/audit", label: "Audit log" },
];

// Loads an admin endpoint. `blocked` is set when the API refuses: not an admin, or an admin
// without two-factor sign-in.
export function useAdminData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [blocked, setBlocked] = useState<"forbidden" | "needs_2fa" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await apiFetch<T>(path));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setBlocked(err.code === "admin_requires_2fa" ? "needs_2fa" : "forbidden");
      else setError(err instanceof Error ? err.message : String(err));
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, blocked, error, reload: load };
}

export function AdminShell({ title, actions, blocked, error, loading, children }: {
  title: string;
  actions?: ReactNode;
  blocked: "forbidden" | "needs_2fa" | null;
  error: string | null;
  loading: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { me } = useSession();

  if (blocked === "forbidden" || (me && !me.platformRole)) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold text-ink">Not available</h1>
        <p className="mt-2 text-sm text-ink-muted">This page is for platform admins.</p>
      </div>
    );
  }
  if (blocked === "needs_2fa") {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold text-ink">Turn on two-factor sign-in</h1>
        <p className="mt-2 text-sm text-ink-muted">An admin account reaches every organization, so the admin panel needs two-factor sign-in on your account.</p>
        <Link href="/account" className="btn-primary mt-5">
          Account and security
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label mb-1">Platform admin</div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        </div>
        {actions}
      </div>
      <nav className="flex gap-4 border-b border-line text-sm">
        {TABS.map((t) => {
          const active = t.href === "/admin" ? pathname === "/admin" || pathname?.startsWith("/admin/orgs") : pathname?.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 pb-2 font-medium ${active ? "border-brand text-ink" : "border-transparent text-ink-subtle hover:text-ink"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {error && <p className="text-sm text-sev-critical">{error}</p>}
      {loading ? (
        <LoadingRegion label="Loading">
          <SkeletonList rows={4} lines={1} />
        </LoadingRegion>
      ) : (
        children
      )}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-subtle">{hint}</div>}
    </div>
  );
}

// Plain, compact table; wide content scrolls inside its card on phones.
export function AdminTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "whitespace-nowrap px-4 py-2.5 text-ink-muted";

export function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const day = (iso: string) => new Date(iso).toLocaleDateString();

export function MonitoringStatus({ pausedAt, pausedBrands = 0, brands = 1 }: { pausedAt: string | null; pausedBrands?: number; brands?: number }) {
  if (pausedAt) return <span className="rounded-full bg-sev-medium/10 px-2 py-0.5 text-xs font-medium text-sev-medium">Paused</span>;
  if (pausedBrands > 0)
    return (
      <span className="rounded-full bg-sev-medium/10 px-2 py-0.5 text-xs font-medium text-sev-medium">
        {pausedBrands} of {brands} paused
      </span>
    );
  return <span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">On</span>;
}
