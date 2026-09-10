"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";
import { SeverityBadge } from "./SeverityBadge";
import type { FindingRow } from "../app/threats/page";

const STATUSES = ["new", "investigating", "confirmed", "false_positive", "resolved"] as const;

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

  return (
    <div className="mt-6">
      {selectedIds.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-blue-600/40 bg-blue-600/10 px-4 py-2 text-sm">
          <span className="text-gray-200">{selectedIds.size} selected</span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            disabled={applying}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100"
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
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100"
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
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {applying ? "Applying…" : "Apply"}
          </button>
          {error && <span className="text-red-400">{error}</span>}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-8 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label="Select all"
                />
              </th>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">
                <Link href={sortLinks.riskScore} className="hover:text-gray-300">
                  Score{currentSort.sortBy === "riskScore" ? (currentSort.sortDir === "asc" ? " ↑" : " ↓") : ""}
                </Link>
              </th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">
                <Link href={sortLinks.firstDetectedAt} className="hover:text-gray-300">
                  First detected{currentSort.sortBy === "firstDetectedAt" ? (currentSort.sortDir === "asc" ? " ↑" : " ↓") : ""}
                </Link>
              </th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id} className="border-t border-gray-800 hover:bg-gray-900/40">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(f.id)}
                    onChange={(e) => toggleOne(f.id, e.target.checked)}
                    aria-label={`Select ${f.identifier}`}
                  />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/threats/${f.id}`} className="text-blue-400 hover:underline">
                    {f.identifier}
                  </Link>
                  {f.brandName && <span className="ml-2 text-xs text-gray-500">({f.brandName})</span>}
                </td>
                <td className="px-4 py-3">
                  <SeverityBadge severity={f.severity} />
                </td>
                <td className="px-4 py-3 font-mono text-gray-200">{f.riskScore}</td>
                <td className="px-4 py-3 text-gray-400">{f.source}</td>
                <td className="px-4 py-3 text-gray-400">{f.status}</td>
                <td className="px-4 py-3 text-gray-400">{new Date(f.firstDetectedAt).toLocaleString()}</td>
              </tr>
            ))}
            {findings.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
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
