"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Select } from "../ui/Field";
import type { Member } from "./types";

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const TYPES = [
  ["domain", "Domains"],
  ["url", "URLs"],
  ["social", "Social"],
] as const;

const chip = "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[12.5px]";
const chipOff = "border-dashed border-border-strong text-muted-foreground hover:border-solid hover:text-foreground";
const chipOn = "border-primary/50 bg-primary-soft text-foreground";

// Filters live in the URL, so a filtered view can be bookmarked and shared, and Back works.
export function ThreatToolbar({ brands, members }: { brands: Array<{ id: string; name: string }>; members: Member[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function set(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  // Search as you type, debounced.
  useEffect(() => {
    if ((params.get("q") ?? "") === q.trim()) return;
    const t = setTimeout(() => set({ q: q.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const severity = params.get("severity");
  const type = params.get("type");
  const active = [severity, type, params.get("brandId"), params.get("assigneeId"), params.get("q")].some(Boolean);

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <label className="flex h-8 min-w-[200px] max-w-[340px] flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-subtle focus-within:outline-2 focus-within:outline-primary">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by domain, URL or handle…"
          aria-label="Filter threats"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-subtle"
        />
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Severity">
        {SEVERITIES.map((s) => (
          <button key={s} type="button" aria-pressed={severity === s} onClick={() => set({ severity: severity === s ? null : s })} className={cn(chip, "capitalize", severity === s ? chipOn : chipOff)}>
            {s}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Type">
        {TYPES.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={type === v} onClick={() => set({ type: type === v ? null : v })} className={cn(chip, type === v ? chipOn : chipOff)}>
            {l}
          </button>
        ))}
      </div>
      {brands.length > 1 && (
        <Select aria-label="Brand" className="h-8 w-auto" value={params.get("brandId") ?? ""} onChange={(e) => set({ brandId: e.target.value || null })}>
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      )}
      <Select aria-label="Assignee" className="h-8 w-auto" value={params.get("assigneeId") ?? ""} onChange={(e) => set({ assigneeId: e.target.value || null })}>
        <option value="">Anyone</option>
        <option value="unassigned">Unassigned</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name || m.email}
          </option>
        ))}
      </Select>
      {active && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            set({ severity: null, type: null, brandId: null, assigneeId: null, q: null });
          }}
          className="inline-flex h-8 items-center gap-1 px-1.5 text-[12.5px] text-subtle hover:text-foreground"
        >
          <X className="size-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}
