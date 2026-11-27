"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError, apiFetch } from "../../lib/api";
import { useSession } from "../../lib/session";
import { KeyRound, ShieldOff } from "lucide-react";
import { LoadingRegion, SkeletonList } from "../Skeleton";
import { PageHeader } from "../ui/PageHeader";
import { LinkTabs } from "../ui/Tabs";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";

const TABS = [
  { href: "/admin", label: "Organizations" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/access-requests", label: "Access requests" },
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
      <div className="mx-auto max-w-md">
        <EmptyState title="Not available" icon={<ShieldOff />}>
          This page is for platform admins.
        </EmptyState>
      </div>
    );
  }
  if (blocked === "needs_2fa") {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState
          title="Turn on two-factor sign-in"
          icon={<KeyRound />}
          action={
            <Button variant="primary" asChild>
              <Link href="/account">Account and security</Link>
            </Button>
          }
        >
          An admin account reaches every organization, so the admin panel needs two-factor sign-in on your account.
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader eyebrow="Platform admin" title={title} actions={actions} />
      <LinkTabs
        label="Admin sections"
        className="mb-4"
        items={TABS.map((t) => ({
          href: t.href,
          label: t.label,
          active: t.href === "/admin" ? pathname === "/admin" || !!pathname?.startsWith("/admin/orgs") : !!pathname?.startsWith(t.href),
        }))}
      />
      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}
      {loading ? (
        <LoadingRegion label="Loading">
          <SkeletonList rows={4} lines={1} />
        </LoadingRegion>
      ) : (
        <div className="flex flex-col gap-4">{children}</div>
      )}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3.5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-[24px] font-semibold tracking-[-0.02em] tabular">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-subtle">{hint}</div>}
    </div>
  );
}

// Plain, compact table; wide content scrolls inside its panel on phones.
export function AdminTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-border bg-raised px-3.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-subtle">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child]:border-b-0 [&>tr]:border-b [&>tr]:border-border">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "whitespace-nowrap px-3.5 py-2.5 text-muted-foreground";

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
