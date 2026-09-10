"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../../lib/api";

interface Summary {
  brand: { id: string; name: string; primaryDomain: string };
  totalFindings: number;
  bySeverity: Record<string, number>;
  lastRun: { id: string; status: string; candidatesTotal: number; candidatesChecked: number; findingsCreated: number } | null;
}

interface RunStatus {
  id: string;
  status: "running" | "completed" | "failed";
  candidatesTotal: number;
  candidatesChecked: number;
  findingsCreated: number;
  error: string | null;
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const data = await apiFetch<Summary>("/api/dashboard/summary");
      setSummary(data);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    const interval = setInterval(async () => {
      const updated = await apiFetch<RunStatus>(`/api/pipeline/runs/${run.id}`);
      setRun(updated);
      if (updated.status !== "running") {
        clearInterval(interval);
        loadSummary();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [run, loadSummary]);

  async function handleRunDiscovery() {
    setError(null);
    try {
      const { runId } = await apiFetch<{ runId: string }>("/api/pipeline/run", { method: "POST" });
      setRun({ id: runId, status: "running", candidatesTotal: 0, candidatesChecked: 0, findingsCreated: 0, error: null });
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-gray-100">Am I protected?</h1>
      {summary && (
        <p className="mt-1 text-gray-400">
          Monitoring <span className="text-gray-200 font-medium">{summary.brand.name}</span> ({summary.brand.primaryDomain})
        </p>
      )}

      <div className="mt-6 flex gap-4">
        <button
          onClick={handleRunDiscovery}
          disabled={run?.status === "running"}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {run?.status === "running" ? "Discovery running…" : "Run discovery"}
        </button>
      </div>

      {run && (
        <div className="mt-4 rounded border border-gray-800 p-4 text-sm text-gray-300">
          <div>Status: <span className="font-medium">{run.status}</span></div>
          {run.candidatesTotal > 0 && (
            <div className="mt-1">
              Checked {run.candidatesChecked} / {run.candidatesTotal} candidate domains — {run.findingsCreated} findings so far
            </div>
          )}
          {run.error && <div className="mt-1 text-red-400">{run.error}</div>}
        </div>
      )}

      {error && <p className="mt-4 text-red-400">{error}</p>}

      {summary && (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {SEVERITY_ORDER.map((sev) => (
            <div key={sev} className="rounded border border-gray-800 p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">{sev}</div>
              <div className="mt-1 text-3xl font-semibold text-gray-100">{summary.bySeverity[sev] ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      {summary && summary.totalFindings === 0 && (
        <p className="mt-6 text-gray-500">No findings yet — click "Run discovery" to scan for lookalike domains.</p>
      )}
    </div>
  );
}
