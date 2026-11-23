"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import { SeverityBadge } from "./SeverityBadge";
import { PendingLink, usePendingNavigation } from "./PendingNavigation";
import { ChevronDownIcon, GlobeIcon, AtIcon, PhoneIcon, LinkIcon } from "./icons";
import { describeTarget, fullDate, sourceLabel, statusLabel, STATUS_PILL, timeAgo } from "../lib/format";
import type { FindingRow } from "../app/threats/page";

const STATUSES = ["new", "investigating", "confirmed", "false_positive", "resolved"] as const;

const SEVERITY_EDGE: Record<string, string> = {
  critical: "bg-critical",
  high: "bg-high",
  medium: "bg-medium",
  low: "bg-transparent",
};

interface Member {
  userId: string;
  email: string;
  role: string;
}

export function TargetIcon({ type, platform }: { type: string; platform: string | null }) {
  const Icon = type === "domain" ? GlobeIcon : platform === "Google Play" || platform === "App Store" ? PhoneIcon : type === "social" ? AtIcon : LinkIcon;
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-elevated text-ink-subtle">
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function ThreatsTable({
  findings,
  sortLinks,
  currentSort,
  showBrand,
}: {
  findings: FindingRow[];
  sortLinks: { riskScore: string; firstDetectedAt: string };
  currentSort: { sortBy: string; sortDir: string };
  showBrand: boolean;
}) {
  const router = useRouter();
  const { navigate } = usePendingNavigation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Member[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkAssigneeId, setBulkAssigneeId] = useState("");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [findings]);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<Member[]>("/api/organization/members");
        setMembers(data);
      } catch {
        // Only feeds the bulk "Assign to" list -- that select just stays empty.
      }
    })();
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? new Set(findings.map((f) => f.id)) : new Set());
    },
    [findings]
  );

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function applyBulkAction() {
    if (!bulkStatus && !bulkAssigneeId) return;
    setApplying(true);
    setError(null);
    try {
      await apiFetch("/api/findings/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          ...(bulkStatus ? { status: bulkStatus } : {}),
          ...(bulkAssigneeId ? { assigneeId: bulkAssigneeId === "unassigned" ? null : bulkAssigneeId } : {}),
        }),
      });
      setBulkStatus("");
      setBulkAssigneeId("");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  const allSelected = findings.length > 0 && selectedIds.size === findings.length;

  function SortHeader({ column, children }: { column: keyof typeof sortLinks; children: React.ReactNode }) {
    const active = currentSort.sortBy === column;
    return (
      <PendingLink href={sortLinks[column]} className={`inline-flex items-center gap-1 hover:text-ink-muted ${active ? "text-ink-muted" : ""}`}>
        {children}
        <ChevronDownIcon className={`h-3 w-3 transition-transform ${active && currentSort.sortDir === "asc" ? "rotate-180" : ""} ${active ? "opacity-100" : "opacity-0"}`} />
      </PendingLink>
    );
  }

  return (
    <div>
      {selectedIds.size > 0 && (
        <div className="card mb-3 flex flex-wrap items-center gap-3 border-brand/40 bg-brand/5 px-4 py-2.5 text-sm">
          <span className="font-medium text-ink">{selectedIds.size} selected</span>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} disabled={applying} className="field-sm">
            <option value="">Set status…</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <select value={bulkAssigneeId} onChange={(e) => setBulkAssigneeId(e.target.value)} disabled={applying} className="field-sm">
            <option value="">Assign to…</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email}
              </option>
            ))}
          </select>
          <button onClick={applyBulkAction} disabled={applying || (!bulkStatus && !bulkAssigneeId)} className="btn-primary px-3 py-1.5 text-xs">
            {applying ? "Applying…" : "Apply"}
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="btn-ghost text-xs">
            Cancel
          </button>
          {error && <span className="text-red-600">{error}</span>}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr className="border-b border-line">
              <th className="w-10 py-3 pl-5 pr-2">
                <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} aria-label="Select all" className="accent-brand" />
              </th>
              <th className="px-3 py-3">Target</th>
              <th className="px-3 py-3">
                <SortHeader column="riskScore">Risk</SortHeader>
              </th>
              <th className="hidden px-3 py-3 md:table-cell">Source</th>
              <th className="hidden px-3 py-3 sm:table-cell">Status</th>
              <th className="hidden px-3 py-3 sm:table-cell">
                <SortHeader column="firstDetectedAt">Found</SortHeader>
              </th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => {
              const target = describeTarget(f.identifier, f.type);
              return (
                <tr
                  key={f.id}
                  onClick={(e) => {
                    // The whole row opens the finding; the checkbox and links keep their own behaviour.
                    if ((e.target as HTMLElement).closest("a, input, button")) return;
                    navigate(`/threats/${f.id}`);
                  }}
                  className="group relative cursor-pointer border-b border-line/70 last:border-0 hover:bg-elevated/50"
                >
                  <td className="relative py-3 pl-5 pr-2">
                    <span className={`absolute inset-y-0 left-0 w-[3px] ${SEVERITY_EDGE[f.severity] ?? "bg-transparent"}`} aria-hidden />
                    <input
                      type="checkbox"
                      checked={selectedIds.has(f.id)}
                      onChange={(e) => toggleOne(f.id, e.target.checked)}
                      aria-label={`Select ${target.primary}`}
                      className="accent-brand"
                    />
                  </td>
                  <td className="w-full max-w-0 px-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <TargetIcon type={f.type} platform={target.platform} />
                      <div className="min-w-0">
                        <Link
                          href={`/threats/${f.id}`}
                          title={f.identifier}
                          className="block truncate font-medium text-ink group-hover:text-brand"
                        >
                          {target.primary}
                        </Link>
                        <div className="truncate text-xs text-ink-subtle" title={f.identifier}>
                          {[target.secondary, showBrand ? f.brandName : null].filter(Boolean).join(" · ") || "Domain"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={f.severity} />
                      <span className="hidden font-mono text-xs tabular-nums text-ink-subtle sm:inline">{f.riskScore}</span>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-3 text-ink-muted md:table-cell">{sourceLabel(f.source)}</td>
                  <td className="hidden whitespace-nowrap px-3 py-3 sm:table-cell">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_PILL[f.status] ?? STATUS_PILL.new}`}>{statusLabel(f.status)}</span>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-3 text-ink-subtle sm:table-cell" title={fullDate(f.firstDetectedAt)}>
                    {timeAgo(f.firstDetectedAt)}
                  </td>
                </tr>
              );
            })}
            {findings.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-14 text-center">
                  <div className="text-sm font-medium text-ink">No findings match these filters</div>
                  <div className="mt-1 text-xs text-ink-subtle">Try another status or severity, or clear the filters.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
