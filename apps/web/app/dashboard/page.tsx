"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../../lib/api";

interface Summary {
  brand: { id: string; name: string; primaryDomain: string };
  totalFindings: number;
  bySeverity: Record<string, number>;
  lastRun: { id: string; status: string; candidatesTotal: number; candidatesChecked: number; findingsCreated: number } | null;
}

interface Brand {
  id: string;
  name: string;
  primaryDomain: string;
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
  const { getToken, orgId, isLoaded } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [showEditBrand, setShowEditBrand] = useState(false);
  const [noBrandYet, setNoBrandYet] = useState(false);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: "", primaryDomain: "" });
  const [editForm, setEditForm] = useState({ name: "", primaryDomain: "" });
  const [submitUrl, setSubmitUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const loadBrands = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await apiFetch<Brand[]>("/api/brands", token);
      setBrands(data);
    } catch {
      // the brand selector is a convenience on top of the summary fetch below, which
      // already surfaces its own errors -- a failed brand-list fetch just hides the
      // selector rather than blocking the page.
    }
  }, [getToken]);

  // brandId is explicit once known (from the selector or a just-created brand) so
  // switching brands doesn't depend on /api/dashboard/summary's own "first brand"
  // default, which only applies when no brandId is given.
  const loadSummary = useCallback(
    async (brandId?: string) => {
      try {
        const token = await getToken();
        const qs = brandId ? `?brandId=${encodeURIComponent(brandId)}` : "";
        const data = await apiFetch<Summary>(`/api/dashboard/summary${qs}`, token);
        setNoBrandYet(false);
        setSummary(data);
        setSelectedBrandId(data.brand.id);
      } catch (err: any) {
        if (String(err.message).includes("404")) {
          setNoBrandYet(true);
        } else {
          setError(err.message);
        }
      }
    },
    [getToken]
  );

  useEffect(() => {
    if (isLoaded && orgId) {
      loadBrands();
      loadSummary();
    }
  }, [isLoaded, orgId, loadBrands, loadSummary]);

  async function handleSelectBrand(brandId: string) {
    setRun(null);
    await loadSummary(brandId);
  }

  useEffect(() => {
    if (!run || run.status !== "running") return;
    const interval = setInterval(async () => {
      const token = await getToken();
      const updated = await apiFetch<RunStatus>(`/api/pipeline/runs/${run.id}`, token);
      setRun(updated);
      if (updated.status !== "running") {
        clearInterval(interval);
        loadSummary();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [run, loadSummary, getToken]);

  async function handleRunDiscovery() {
    if (!selectedBrandId) return;
    setError(null);
    try {
      const token = await getToken();
      const { runId } = await apiFetch<{ runId: string }>("/api/pipeline/run", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: selectedBrandId }),
      });
      setRun({ id: runId, status: "running", candidatesTotal: 0, candidatesChecked: 0, findingsCreated: 0, error: null });
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBrandId) return;
    setSubmitting(true);
    setSubmitMessage(null);
    setError(null);
    try {
      const token = await getToken();
      await apiFetch("/api/findings/manual-submit", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: selectedBrandId, url: submitUrl }),
      });
      setSubmitUrl("");
      setSubmitMessage("Submitted — it'll be scored within a few minutes. Check the Threats page.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateBrand(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      const created = await apiFetch<Brand>("/api/brands", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, primaryDomain: form.primaryDomain }),
      });
      setForm({ name: "", primaryDomain: "" });
      setShowAddBrand(false);
      await loadBrands();
      await loadSummary(created.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function handleToggleEdit() {
    if (!showEditBrand && summary) {
      setEditForm({ name: summary.brand.name, primaryDomain: summary.brand.primaryDomain });
    }
    setShowEditBrand((v) => !v);
  }

  async function handleUpdateBrand(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBrandId) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await apiFetch(`/api/brands/${selectedBrandId}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editForm.name, primaryDomain: editForm.primaryDomain }),
      });
      setShowEditBrand(false);
      await loadBrands();
      await loadSummary(selectedBrandId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteBrand() {
    if (!selectedBrandId || !summary) return;
    const confirmed = window.confirm(
      `Delete "${summary.brand.name}" and everything under it (all findings, scans, notes, takedowns)? This can't be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      const token = await getToken();
      await apiFetch(`/api/brands/${selectedBrandId}`, token, { method: "DELETE" });
      const remaining = await (async () => {
        const t = await getToken();
        return apiFetch<Brand[]>("/api/brands", t);
      })();
      setBrands(remaining);
      if (remaining.length > 0) {
        await loadSummary(remaining[0].id);
      } else {
        setSummary(null);
        setSelectedBrandId(null);
        setNoBrandYet(true);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  if (!isLoaded) return null;

  if (!orgId) {
    return (
      <div className="max-w-lg">
        <h1 className="text-2xl font-semibold text-gray-100">Select or create an organization</h1>
        <p className="mt-2 text-gray-400">Use the organization switcher in the top bar to continue.</p>
      </div>
    );
  }

  if (noBrandYet) {
    return (
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold text-gray-100">Protect your first brand</h1>
        <p className="mt-1 text-gray-400">Enter the brand name and its primary domain to start monitoring.</p>
        <form onSubmit={handleCreateBrand} className="mt-6 space-y-4">
          <input
            required
            placeholder="Brand name (e.g. Jambojet)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
          <input
            required
            placeholder="Primary domain (e.g. jambojet.com)"
            value={form.primaryDomain}
            onChange={(e) => setForm({ ...form, primaryDomain: e.target.value })}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create brand"}
          </button>
        </form>
        {error && <p className="mt-4 text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-gray-100">Am I protected?</h1>
      {summary && (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <p className="text-gray-400">
            Monitoring <span className="text-gray-200 font-medium">{summary.brand.name}</span> ({summary.brand.primaryDomain})
          </p>
          {brands.length > 0 && (
            <select
              value={selectedBrandId ?? ""}
              onChange={(e) => handleSelectBrand(e.target.value)}
              className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100"
              aria-label="Select brand"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => setShowAddBrand((v) => !v)} className="text-xs text-blue-400 hover:underline">
            + Add brand
          </button>
          <button onClick={handleToggleEdit} className="text-xs text-blue-400 hover:underline">
            Edit
          </button>
          <button
            onClick={handleDeleteBrand}
            disabled={deleting}
            className="text-xs text-red-400 hover:underline disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete brand"}
          </button>
        </div>
      )}

      {showAddBrand && (
        <form onSubmit={handleCreateBrand} className="mt-3 flex flex-wrap gap-2">
          <input
            required
            placeholder="Brand name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100"
          />
          <input
            required
            placeholder="Primary domain"
            value={form.primaryDomain}
            onChange={(e) => setForm({ ...form, primaryDomain: e.target.value })}
            className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      {showEditBrand && (
        <form onSubmit={handleUpdateBrand} className="mt-3 flex flex-wrap gap-2">
          <input
            required
            placeholder="Brand name"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100"
          />
          <input
            required
            placeholder="Primary domain"
            value={editForm.primaryDomain}
            onChange={(e) => setEditForm({ ...editForm, primaryDomain: e.target.value })}
            className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
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

      <form onSubmit={handleManualSubmit} className="mt-6 flex gap-2">
        <input
          required
          type="url"
          placeholder="Report a suspicious URL (e.g. a fake social profile)"
          value={submitUrl}
          onChange={(e) => setSubmitUrl(e.target.value)}
          className="w-full max-w-md rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
      {submitMessage && <p className="mt-2 text-sm text-green-400">{submitMessage}</p>}

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
