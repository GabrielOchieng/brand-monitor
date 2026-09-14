"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";
import { SeverityBadge } from "./SeverityBadge";
import { ChevronDownIcon } from "./icons";
import type { FindingRow } from "../app/threats/page";

const STATUSES = ["new", "investigating", "confirmed", "false_positive", "resolved"] as const;

const STATUS_STYLES: Record<string, string> = {
  new: "text-ink-muted",
  investigating: "text-brand",
  confirmed: "text-amber-700",
  false_positive: "text-ink-subtle line-through decoration-gray-400",
  resolved: "text-emerald-600",
};

interface Member {
  userId: string;
  email: string;
  role: string;
}

export function ThreatsTable({
  findings,
  sortLinks,
  currentSort,
}: {
  findings: FindingRow[];
  sortLinks: { riskScore: string; firstDetectedAt: string };
  currentSort: { sortBy: string; sortDir: string };
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Member[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkAssigneeId, setBulkAssigneeId] = useState("");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server re-runs on router.refresh() and passes a NEW findings array, but React
  // may reuse this same component instance rather than remounting it -- without this,
  // a stale selection could silently survive and reference rows that just changed
  // status or left the current filter view.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [findings]);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const data = await apiFetch<Member[]>("/api/organization/members", token);
        setMembers(data);
      } catch {
        // bulk-assign dropdown just stays empty on failure -- non-critical
      }
    })();
  }, [getToken]);

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
      const token = await getToken();
      await apiFetch("/api/findings/bulk", token, {
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
      <Link href={sortLinks[column]} className={`inline-flex items-center gap-1 hover:text-ink-muted ${active ? "text-ink-muted" : ""}`}>
        {children}
        <ChevronDownIcon className={`h-3 w-3 transition-transform ${active && currentSort.sortDir === "asc" ? "rotate-180" : ""} ${active ? "opacity-100" : "opacity-0"}`} />
      </Link>
    );
  }

  return (
    <div className="mt-6">
      {selectedIds.size > 0 && (
        <div className="card mb-3 flex flex-wrap items-center gap-3 border-brand/40 bg-brand/10 px-4 py-2.5 text-sm">
          <span className="font-medium text-ink">{selectedIds.size} selected</span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            disabled={applying}
            className="field-sm"
          >
            <option value="">Set status…</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <select
            value={bulkAssigneeId}
            onChange={(e) => setBulkAssigneeId(e.target.value)}
            disabled={applying}
            className="field-sm"
          >
            <option value="">Assign to…</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email}
              </option>
            ))}
          </select>
          <button
            onClick={applyBulkAction}
            disabled={applying || (!bulkStatus && !bulkAssigneeId)}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {applying ? "Applying…" : "Apply"}
          </button>
          {error && <span className="text-red-600">{error}</span>}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr className="border-b border-line">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label="Select all"
                  className="accent-brand"
                />
              </th>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">
                <SortHeader column="riskScore">Score</SortHeader>
              </th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">
                <SortHeader column="firstDetectedAt">First detected</SortHeader>
              </th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} className="border-b border-line/60 last:border-0 hover:bg-elevated/60">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(f.id)}
                    onChange={(e) => toggleOne(f.id, e.target.checked)}
                    aria-label={`Select ${f.identifier}`}
                    className="accent-brand"
                  />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/threats/${f.id}`} className="font-mono text-[13px] text-ink hover:text-brand-hover">
                    {f.identifier}
                  </Link>
                  {f.brandName && <span className="ml-2 text-xs text-ink-subtle">({f.brandName})</span>}
                </td>
                <td className="px-4 py-3">
                  <SeverityBadge severity={f.severity} />
                </td>
                <td className="px-4 py-3 font-mono tabular-nums text-ink">{f.riskScore}</td>
                <td className="px-4 py-3 text-ink-subtle">{f.source}</td>
                <td className={`px-4 py-3 font-medium capitalize ${STATUS_STYLES[f.status] ?? "text-ink-muted"}`}>
                  {f.status.replace("_", " ")}
                </td>
                <td className="px-4 py-3 text-ink-subtle">{new Date(f.firstDetectedAt).toLocaleString()}</td>
              </tr>
            ))}
            {findings.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-subtle">
                  No findings match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
