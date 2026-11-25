"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useBrands } from "../../lib/brand";
import { useSession } from "../../lib/session";
import { canManage, useMyRole } from "../../lib/useMyRole";
import { cn } from "../../lib/cn";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/Tabs";
import { SettingsSkeleton } from "../../components/PageSkeletons";
import { ReadOnlyNote } from "../../components/settings/Section";
import {
  AccountsSection,
  AddBrandSection,
  BrandDetails,
  DeleteBrandSection,
  KeywordsSection,
  ReportFormSection,
  VisualReferenceSection,
} from "../../components/settings/BrandSettings";

const TABS = [
  ["details", "Details"],
  ["keywords", "Keywords"],
  ["accounts", "Official accounts"],
  ["visual", "Visual reference"],
  ["report-form", "Report form"],
] as const;

type Tab = (typeof TABS)[number][0];

interface Summary {
  openTotal: number;
  newThisWeek: number;
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

// Brands: what each one is, what's monitored for it, and what counts as its own.
export default function BrandsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <Brands />
    </Suspense>
  );
}

function Brands() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { isLoaded, me } = useSession();
  const role = useMyRole();
  const { brands, selected, select, reload } = useBrands();
  const [summary, setSummary] = useState<Summary | null>(null);
  const editable = canManage(role) && !me?.adminView;
  const adding = params.get("add") === "1";
  const tab: Tab = TABS.some(([k]) => k === params.get("tab")) ? (params.get("tab") as Tab) : "details";

  useEffect(() => {
    if (!selected) return;
    setSummary(null);
    apiFetch<Summary>(`/api/dashboard/summary?brandId=${selected.id}`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [selected]);

  function go(q: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(q)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  if (!isLoaded || brands === null || role === null) return <SettingsSkeleton />;

  const header = (
    <PageHeader
      title="Brands"
      description="What's monitored for each brand, and what counts as its own."
      actions={
        <>
          {brands.length > 1 &&
            !adding &&
            brands.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => select(b.id)}
                aria-pressed={b.id === selected?.id}
                className={cn(
                  "inline-flex h-8 items-center rounded-md border px-2.5 text-[12.5px]",
                  b.id === selected?.id ? "border-primary/50 bg-primary-soft text-foreground" : "border-dashed border-border-strong text-muted-foreground hover:border-solid hover:text-foreground"
                )}
              >
                {b.name}
              </button>
            ))}
          {editable && !adding && (
            <Button onClick={() => go({ add: "1" })}>
              <Plus />
              Add brand
            </Button>
          )}
        </>
      }
    />
  );

  if (adding) {
    return (
      <div>
        {header}
        {editable ? (
          <div className="flex max-w-3xl flex-col gap-3">
            <AddBrandSection
              onCreated={async (id) => {
                await reload();
                select(id);
                router.replace("/brands");
              }}
            />
            <Link href="/brands" className="text-[13px] text-primary hover:underline">
              Cancel
            </Link>
          </div>
        ) : (
          <ReadOnlyNote who="owners and admins" />
        )}
      </div>
    );
  }

  if (!selected) {
    return (
      <div>
        {header}
        <EmptyState
          title="No brands yet"
          action={
            editable && (
              <Button variant="primary" onClick={() => go({ add: "1" })}>
                <Plus />
                Add a brand
              </Button>
            )
          }
        >
          Add a brand to start monitoring lookalikes of it.
        </EmptyState>
      </div>
    );
  }

  return (
    <div>
      {header}
      <Tabs value={tab} onValueChange={(t) => go({ tab: t === "details" ? null : t })}>
        <section className="mb-4 rounded-md border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-[18px]">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft font-bold text-primary">{initials(selected.name)}</span>
              <div className="min-w-0">
                <h2 className="truncate text-[17px] font-semibold">{selected.name}</h2>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-subtle">
                  <span className="font-mono">{selected.primaryDomain}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("size-[7px] rounded-full", selected.monitoringPausedAt ? "bg-sev-medium" : "bg-ok")} aria-hidden="true" />
                    {selected.monitoringPausedAt ? "Paused by the platform admin" : "Monitoring"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-6 text-xs text-subtle">
              <Link href={`/threats?brandId=${selected.id}`} className="hover:text-foreground">
                <b className="block text-[17px] font-semibold text-foreground tabular">{summary?.openTotal ?? "–"}</b>
                open threats
              </Link>
              <Link href={`/threats?brandId=${selected.id}&sortBy=firstDetectedAt`} className="hover:text-foreground">
                <b className="block text-[17px] font-semibold text-foreground tabular">{summary?.newThisWeek ?? "–"}</b>
                new this week
              </Link>
            </div>
          </div>
          <TabsList className="border-b-0 border-t px-2.5">
            {TABS.map(([k, l]) => (
              <TabsTrigger key={k} value={k}>
                {l}
              </TabsTrigger>
            ))}
          </TabsList>
        </section>
      </Tabs>

      <div className="flex max-w-4xl flex-col gap-5">
        {!editable && tab !== "visual" && <ReadOnlyNote who="owners and admins" />}
        {tab === "details" && (
          <>
            <BrandDetails key={selected.id} brand={{ ...selected, reportToken: selected.reportToken ?? null }} editable={editable} onSaved={reload} />
            {editable && (
              <DeleteBrandSection
                brand={{ ...selected, reportToken: selected.reportToken ?? null }}
                onDeleted={async () => {
                  await reload();
                  router.replace("/brands");
                }}
              />
            )}
          </>
        )}
        {tab === "keywords" && <KeywordsSection key={selected.id} brand={{ ...selected, reportToken: selected.reportToken ?? null }} editable={editable} />}
        {tab === "accounts" && <AccountsSection key={selected.id} brand={{ ...selected, reportToken: selected.reportToken ?? null }} editable={editable} />}
        {tab === "visual" && <VisualReferenceSection key={selected.id} brand={{ ...selected, reportToken: selected.reportToken ?? null }} />}
        {tab === "report-form" && <ReportFormSection key={selected.id} brand={{ ...selected, reportToken: selected.reportToken ?? null }} editable={editable} onChange={() => reload()} />}
      </div>
    </div>
  );
}
