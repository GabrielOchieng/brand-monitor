"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePendingNavigation } from "./PendingNavigation";
import { SearchIcon, XIcon } from "./icons";
import { statusLabel } from "../lib/format";

const STATUSES = ["new", "investigating", "confirmed", "false_positive", "resolved"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

// Filters apply as soon as they change (search after a short pause in typing) -- no
// "Apply filters" button. Every change resets to page 1.
export function ThreatFilters({
  brands,
  members,
}: {
  brands: Array<{ id: string; name: string }>;
  members: Array<{ userId: string; email: string }>;
}) {
  const params = useSearchParams();
  const { navigate } = usePendingNavigation();
  const [q, setQ] = useState(params.get("q") ?? "");
  const debounce = useRef<number | null>(null);

  function apply(overrides: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    const qs = next.toString();
    navigate(`/threats${qs ? `?${qs}` : ""}`);
  }

  useEffect(() => () => {
    if (debounce.current) window.clearTimeout(debounce.current);
  }, []);

  function onSearch(value: string) {
    setQ(value);
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => apply({ q: value.trim() }), 400);
  }

  // No status in the URL means the default view: open findings only.
  const status = params.get("status") ?? "open";
  const active = Boolean(params.get("status") || params.get("severity") || params.get("brandId") || params.get("assigneeId") || params.get("q"));

  return (
    <div className="card mt-4 flex flex-wrap items-end gap-3 p-4">
      <Filter label="Status">
        <select value={status} onChange={(e) => apply({ status: e.target.value === "open" ? "" : e.target.value })} className="field-sm">
          <option value="open">Open</option>
          <option value="all">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </Filter>
      <Filter label="Severity">
        <select value={params.get("severity") ?? ""} onChange={(e) => apply({ severity: e.target.value })} className="field-sm">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </Filter>
      {brands.length > 1 && (
        <Filter label="Brand">
          <select value={params.get("brandId") ?? ""} onChange={(e) => apply({ brandId: e.target.value })} className="field-sm">
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Filter>
      )}
      <Filter label="Assignee">
        <select value={params.get("assigneeId") ?? ""} onChange={(e) => apply({ assigneeId: e.target.value })} className="field-sm max-w-[14rem]">
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.email}
            </option>
          ))}
        </select>
      </Filter>
      <div className="min-w-[12rem] flex-1">
        <label className="label mb-1">Search</label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
          <input
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Domain, handle or URL…"
            className="field-sm w-full pl-8"
            aria-label="Search findings"
          />
        </div>
      </div>
      {active && (
        <button
          onClick={() => {
            setQ("");
            navigate("/threats");
          }}
          className="btn-ghost text-xs"
        >
          <XIcon className="h-3.5 w-3.5" /> Clear
        </button>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label mb-1">{label}</label>
      {children}
    </div>
  );
}
