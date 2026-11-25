"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { describeTarget, fullDate, sourceLabel, timeAgo } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Button, Kbd } from "../ui/Button";
import { Select } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { Ident, SEV_BG, ScoreMeter, SeverityTag, StatusPill, TypeTag, WebState } from "./atoms";
import { ThreatPanel } from "./ThreatPanel";
import { useCanAct, useSetStatus } from "./useThreatActions";
import type { FindingRow, Member } from "./types";

type SortKey = "riskScore" | "firstDetectedAt";
type Props = {
  findings: FindingRow[];
  members: Member[];
  showBrand: boolean;
  sort: { sortBy: string; sortDir: string };
  sortHrefs: Record<SortKey, string>;
};

const WIDE = "(min-width: 1024px)";

function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (el as HTMLElement).isContentEditable);
}

// The triage queue: a dense table on desktop (stacked rows on phones), a side panel for the
// threat under the cursor, keyboard triage, and bulk changes for the selected rows.
export function ThreatQueue({ findings, members, showBrand, sort, sortHrefs }: Props) {
  const router = useRouter();
  const toast = useToast();
  const canAct = useCanAct();
  const setStatus = useSetStatus();
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    setStatusOverride({});
    setSelected(new Set());
    setCursor(0);
    setPanelId((id) => (id && findings.some((f) => f.id === id) ? id : null));
  }, [findings]);

  const rows = useMemo(() => findings.map((f) => ({ ...f, status: statusOverride[f.id] ?? f.status })), [findings, statusOverride]);

  const open = useCallback(
    (id: string) => {
      if (window.matchMedia(WIDE).matches) {
        setPanelId(id);
        setCursor(Math.max(0, findings.findIndex((f) => f.id === id)));
      } else router.push(`/threats/${id}`);
    },
    [findings, router]
  );

  const change = useCallback(
    (row: FindingRow, to: string) => {
      if (!canAct || row.status === to) return;
      setStatus(row.id, describeTarget(row.identifier, row.type).primary, row.status, to, (s) => setStatusOverride((o) => ({ ...o, [row.id]: s })));
    },
    [canAct, setStatus]
  );

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Keep the cursor row in view as j/k move it.
  useEffect(() => {
    const row = rows[cursor];
    if (row) rowRefs.current[row.id]?.scrollIntoView({ block: "nearest" });
  }, [cursor, rows]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping() || document.querySelector('[role="dialog"][data-state="open"]')) return;
      const row = rows[cursor];
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next = Math.min(rows.length - 1, Math.max(0, cursor + (e.key === "j" ? 1 : -1)));
        setCursor(next);
        if (panelId && rows[next]) setPanelId(rows[next].id);
      } else if (e.key === "Enter" && row) open(row.id);
      else if (e.key === "o" && row) router.push(`/threats/${row.id}`);
      else if (e.key === "x" && row) toggle(row.id);
      else if (e.key === "c" && row && (row.status === "new" || row.status === "investigating")) change(row, "confirmed");
      else if (e.key === "d" && row && row.status !== "false_positive") change(row, "false_positive");
      else if (e.key === "Escape" && panelId) setPanelId(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rows, cursor, panelId, open, toggle, change, router]);

  async function bulk(body: { status?: string; assigneeId?: string | null }, verb: string) {
    const ids = [...selected];
    setBusy(true);
    try {
      const r = await apiFetch<{ updatedCount: number; requestedCount: number }>("/api/findings/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, ...body }),
      });
      toast(r.updatedCount === r.requestedCount ? `${verb} ${r.updatedCount} threat${r.updatedCount === 1 ? "" : "s"}` : `${verb} ${r.updatedCount} of ${r.requestedCount} threats`);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't update the selected threats.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const panelIndex = panelId ? rows.findIndex((r) => r.id === panelId) : -1;
  const panelRow = panelIndex >= 0 ? rows[panelIndex] : null;
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function SortHeader({ k, children }: { k: SortKey; children: string }) {
    const active = sort.sortBy === k;
    return (
      <Link href={sortHrefs[k]} scroll={false} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")} aria-sort={active ? (sort.sortDir === "asc" ? "ascending" : "descending") : undefined}>
        {children}
        {active && (sort.sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </Link>
    );
  }

  const th = "sticky top-0 whitespace-nowrap border-b border-border bg-raised px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] text-subtle";
  const td = "border-b border-border px-3 py-2 align-middle whitespace-nowrap";

  return (
    <div>
      {canAct && selected.size > 0 && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-md border border-primary/35 bg-primary-soft px-2.5 py-1.5 text-[13px]">
          <b className="font-mono text-primary">{selected.size}</b> selected
          <Button size="sm" disabled={busy} onClick={() => bulk({ status: "confirmed" }, "Confirmed")}>
            Confirm
          </Button>
          <Button size="sm" disabled={busy} onClick={() => bulk({ status: "investigating" }, "Marked investigating:")}>
            Investigating
          </Button>
          <Button size="sm" disabled={busy} onClick={() => bulk({ status: "resolved" }, "Resolved")}>
            Resolve
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => bulk({ status: "false_positive" }, "Dismissed")}>
            Dismiss
          </Button>
          <Select
            aria-label="Assign selected threats to"
            className="h-7 w-auto"
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && bulk({ assigneeId: e.target.value === "none" ? null : e.target.value }, "Reassigned")}
          >
            <option value="">Assign to…</option>
            <option value="none">Nobody</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name || m.email}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className={cn("grid grid-cols-1", panelRow && "lg:grid-cols-[minmax(0,1fr)_minmax(380px,50%)] xl:grid-cols-[minmax(0,1fr)_minmax(420px,46%)]")}>
        <div className="min-w-0">
          {/* Desktop and tablet: the table. */}
          <div className={cn("hidden overflow-x-auto rounded-md border border-border bg-card md:block", panelRow && "lg:rounded-r-none")}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {canAct && (
                    <th className={cn(th, "w-8")}>
                      <input type="checkbox" className="size-3.5 accent-[var(--primary)]" aria-label="Select all on this page" checked={allChecked} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                    </th>
                  )}
                  <th className={th}>Severity</th>
                  <th className={th}>Threat</th>
                  <th className={th}>
                    <SortHeader k="riskScore">Score</SortHeader>
                  </th>
                  {!panelRow && <th className={th}>Type</th>}
                  <th className={th}>Status</th>
                  {!panelRow && <th className={th}>Website</th>}
                  {!panelRow && showBrand && <th className={th}>Brand</th>}
                  {!panelRow && <th className={cn(th, "max-xl:hidden")}>Source</th>}
                  {!panelRow && (
                    <th className={th}>
                      <SortHeader k="firstDetectedAt">Found</SortHeader>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((f, i) => {
                  const t = describeTarget(f.identifier, f.type);
                  const isCursor = i === cursor;
                  return (
                    <tr
                      key={f.id}
                      ref={(el) => {
                        rowRefs.current[f.id] = el;
                      }}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("input,a,button")) return;
                        setCursor(i);
                        open(f.id);
                      }}
                      className={cn(
                        "cursor-pointer hover:[&>td]:bg-hover",
                        isCursor && "[&>td]:bg-hover [&>td:first-child]:shadow-[inset_2px_0_0_var(--primary)]",
                        panelId === f.id && "[&>td]:bg-primary-soft"
                      )}
                    >
                      {canAct && (
                        <td className={td}>
                          <input type="checkbox" className="size-3.5 accent-[var(--primary)]" aria-label={`Select ${t.primary}`} checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                        </td>
                      )}
                      <td className={td}>
                        <SeverityTag severity={f.severity} />
                      </td>
                      <td className={cn(td, "min-w-[220px] whitespace-normal")}>
                        <Link href={`/threats/${f.id}`} className="hover:text-primary" onClick={(e) => window.matchMedia(WIDE).matches && (e.preventDefault(), open(f.id))}>
                          <Ident value={t.primary} highlight={f.type !== "social"} />
                        </Link>
                        <small className="mt-px block text-[11.5px] text-subtle">{f.topReason ?? t.secondary ?? sourceLabel(f.source)}</small>
                      </td>
                      <td className={td}>
                        <ScoreMeter score={f.riskScore} severity={f.severity} />
                      </td>
                      {!panelRow && (
                        <td className={td}>
                          <TypeTag type={t.platform === "Google Play" || t.platform === "App Store" ? "app" : f.type} />
                        </td>
                      )}
                      <td className={td}>
                        <StatusPill status={f.status} />
                      </td>
                      {!panelRow && <td className={td}>{f.webState ? <WebState state={f.webState} /> : <span className="text-xs text-subtle">n/a</span>}</td>}
                      {!panelRow && showBrand && <td className={cn(td, "text-muted-foreground")}>{f.brandName}</td>}
                      {!panelRow && <td className={cn(td, "text-subtle max-xl:hidden")}>{sourceLabel(f.source)}</td>}
                      {!panelRow && (
                        <td className={cn(td, "font-mono text-xs text-subtle")} title={fullDate(f.firstDetectedAt)}>
                          {timeAgo(f.firstDetectedAt)}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones: stacked rows. */}
          <ul className="flex flex-col rounded-md border border-border bg-card md:hidden">
            {rows.map((f) => {
              const t = describeTarget(f.identifier, f.type);
              return (
                <li key={f.id} className="grid grid-cols-[auto_4px_minmax(0,1fr)] items-start gap-2.5 border-b border-border py-2.5 pl-2.5 pr-3 last:border-b-0">
                  {canAct ? (
                    <input type="checkbox" className="mt-1 size-3.5 accent-[var(--primary)]" aria-label={`Select ${t.primary}`} checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                  ) : (
                    <span />
                  )}
                  <span className={cn("self-stretch rounded-sm", SEV_BG[f.severity])} aria-hidden="true" />
                  <Link href={`/threats/${f.id}`} className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <Ident value={t.primary} highlight={f.type !== "social"} className="min-w-0" />
                      <ScoreMeter score={f.riskScore} severity={f.severity} />
                    </span>
                    {(f.topReason || t.secondary) && <span className="text-[12.5px] text-muted-foreground">{f.topReason ?? t.secondary}</span>}
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                      <StatusPill status={f.status} />
                      <WebState state={f.webState} />
                      <span>{sourceLabel(f.source)}</span>
                      <span>{timeAgo(f.firstDetectedAt)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {panelRow && (
          <div className="hidden min-w-0 lg:block">
            <ThreatPanel
              id={panelRow.id}
              index={panelIndex}
              total={rows.length}
              status={panelRow.status}
              onStep={(d) => {
                const next = rows[panelIndex + d];
                if (next) {
                  setPanelId(next.id);
                  setCursor(panelIndex + d);
                }
              }}
              onClose={() => setPanelId(null)}
              onConfirm={() => change(panelRow, "confirmed")}
              onDismiss={() => change(panelRow, "false_positive")}
            />
          </div>
        )}
      </div>

      <p className="mt-2.5 hidden flex-wrap gap-x-3 gap-y-1 text-xs text-subtle lg:flex">
        <span>
          <Kbd>j</Kbd> <Kbd>k</Kbd> move
        </span>
        <span>
          <Kbd>Enter</Kbd> open
        </span>
        {canAct && (
          <>
            <span>
              <Kbd>x</Kbd> select
            </span>
            <span>
              <Kbd>c</Kbd> confirm
            </span>
            <span>
              <Kbd>d</Kbd> dismiss
            </span>
          </>
        )}
        <span>
          <Kbd>o</Kbd> full page
        </span>
        <span>
          <Kbd>Esc</Kbd> close panel
        </span>
      </p>
    </div>
  );
}
