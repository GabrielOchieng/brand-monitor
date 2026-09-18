"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { apiFetch, API_URL } from "../../lib/api";
import { PlusIcon, PencilIcon, TrashIcon, ImageIcon, RadarIcon, FlagIcon, TagIcon, ChevronDownIcon } from "../../components/icons";
import { BrandKeywords } from "../../components/BrandKeywords";

interface Summary {
  brand: { id: string; name: string; primaryDomain: string; hasVisualBaseline: boolean };
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
const SEVERITY_STAT_STYLES: Record<string, string> = {
  critical: "border-l-critical",
  high: "border-l-high",
  medium: "border-l-medium",
  low: "border-l-low",
};

export default function DashboardPage() {
  const { getToken, orgId, isLoaded } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [showEditBrand, setShowEditBrand] = useState(false);
  const [showKeywords, setShowKeywords] = useState(false);
  const [noBrandYet, setNoBrandYet] = useState(false);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: "", primaryDomain: "", concatKeywords: "" });
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
      const concatKeywords = form.concatKeywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const created = await apiFetch<Brand>("/api/brands", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, primaryDomain: form.primaryDomain, concatKeywords }),
      });
      setForm({ name: "", primaryDomain: "", concatKeywords: "" });
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
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold text-ink">Select or create an organization</h1>
        <p className="mt-2 text-sm text-ink-muted">Use the organization switcher in the top bar to continue.</p>
      </div>
    );
  }

  if (noBrandYet) {
    return (
      <div className="card mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold text-ink">Protect your first brand</h1>
        <p className="mt-1 text-sm text-ink-muted">Enter the brand name and its primary domain to start monitoring.</p>
        <form onSubmit={handleCreateBrand} className="mt-6 space-y-3">
          <input
            required
            placeholder="Brand name (e.g. Jambojet)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="field w-full"
          />
          <input
            required
            placeholder="Primary domain (e.g. jambojet.com)"
            value={form.primaryDomain}
            onChange={(e) => setForm({ ...form, primaryDomain: e.target.value })}
            className="field w-full"
          />
          <input
            placeholder="Keywords, comma-separated (e.g. book, checkin, login)"
            value={form.concatKeywords}
            onChange={(e) => setForm({ ...form, concatKeywords: e.target.value })}
            className="field w-full"
          />
          <p className="text-xs text-ink-subtle">
            Optional, but recommended — discovery combines these with the brand name to catch
            lookalikes like "bookjambojet.com" that a bare typo-check would miss.
          </p>
          <button type="submit" disabled={creating} className="btn-primary w-full">
            {creating ? "Creating…" : "Create brand"}
          </button>
        </form>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Am I protected?</h1>

      {summary && (
        <div className="card mt-4 flex flex-wrap items-center gap-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-muted">Monitoring</span>
            <div className="relative">
              <select
                value={selectedBrandId ?? ""}
                onChange={(e) => handleSelectBrand(e.target.value)}
                className="field-sm appearance-none py-1.5 pr-7 font-medium text-ink"
                aria-label="Select brand"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
            </div>
            <span className="text-sm text-ink-subtle">({summary.brand.primaryDomain})</span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1">
            <button onClick={() => setShowAddBrand((v) => !v)} className="btn-ghost whitespace-nowrap">
              <PlusIcon className="h-3.5 w-3.5" /> Add brand
            </button>
            <button onClick={handleToggleEdit} className="btn-ghost whitespace-nowrap">
              <PencilIcon className="h-3.5 w-3.5" /> Edit
            </button>
            <button onClick={() => setShowKeywords((v) => !v)} className="btn-ghost whitespace-nowrap">
              <TagIcon className="h-3.5 w-3.5" /> Keywords
            </button>
            {summary.brand.hasVisualBaseline && (
              <a
                href={`${API_URL}/screenshots/brand-${summary.brand.id}.png`}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost whitespace-nowrap"
              >
                <ImageIcon className="h-3.5 w-3.5" /> Visual reference
              </a>
            )}
            <button onClick={handleDeleteBrand} disabled={deleting} className="btn-danger whitespace-nowrap">
              <TrashIcon className="h-3.5 w-3.5" /> {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      )}

      {showAddBrand && (
        <form onSubmit={handleCreateBrand} className="card mt-3 flex flex-wrap gap-2 p-4">
          <input
            required
            placeholder="Brand name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="field"
          />
          <input
            required
            placeholder="Primary domain"
            value={form.primaryDomain}
            onChange={(e) => setForm({ ...form, primaryDomain: e.target.value })}
            className="field"
          />
          <input
            placeholder="Keywords, comma-separated (optional)"
            value={form.concatKeywords}
            onChange={(e) => setForm({ ...form, concatKeywords: e.target.value })}
            className="field"
          />
          <button type="submit" disabled={creating} className="btn-primary">
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      {showEditBrand && (
        <form onSubmit={handleUpdateBrand} className="card mt-3 flex flex-wrap gap-2 p-4">
          <input
            required
            placeholder="Brand name"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            className="field"
          />
          <input
            required
            placeholder="Primary domain"
            value={editForm.primaryDomain}
            onChange={(e) => setEditForm({ ...editForm, primaryDomain: e.target.value })}
            className="field"
          />
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      )}

      {showKeywords && selectedBrandId && <BrandKeywords brandId={selectedBrandId} />}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="card flex flex-col justify-between p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand">
              <RadarIcon className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-medium text-ink">Discovery scan</div>
              <p className="mt-0.5 text-xs text-ink-subtle">Generate and check lookalike domains for this brand.</p>
            </div>
          </div>
          <button
            onClick={handleRunDiscovery}
            disabled={run?.status === "running"}
            className="btn-primary mt-4 self-start"
          >
            {run?.status === "running" ? "Discovery running…" : "Run discovery"}
          </button>
        </div>

        <div className="card p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/15 text-brand">
              <FlagIcon className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-medium text-ink">Report a suspicious URL</div>
              <p className="mt-0.5 text-xs text-ink-subtle">A fake social profile or any other page discovery can't reach.</p>
            </div>
          </div>
          <form onSubmit={handleManualSubmit} className="mt-4 flex gap-2">
            <input
              required
              type="url"
              placeholder="https://…"
              value={submitUrl}
              onChange={(e) => setSubmitUrl(e.target.value)}
              className="field flex-1"
            />
            <button type="submit" disabled={submitting} className="btn-secondary shrink-0">
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </form>
          {submitMessage && <p className="mt-2 text-xs text-emerald-600">{submitMessage}</p>}
        </div>
      </div>

      {run && (
        <div className="card mt-4 p-4 text-sm text-ink-muted">
          <div>Status: <span className="font-medium text-ink">{run.status}</span></div>
          {run.candidatesTotal > 0 && (
            <div className="mt-1 text-ink-muted">
              Checked {run.candidatesChecked} / {run.candidatesTotal} candidate domains — {run.findingsCreated} findings so far
            </div>
          )}
          {run.error && <div className="mt-1 text-red-600">{run.error}</div>}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {summary && (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {SEVERITY_ORDER.map((sev) => (
            <Link
              key={sev}
              href={`/threats?severity=${sev}&brandId=${summary.brand.id}`}
              className={`card block border-l-[3px] p-4 transition-shadow hover:shadow-md ${SEVERITY_STAT_STYLES[sev]}`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{sev}</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-ink">{summary.bySeverity[sev] ?? 0}</div>
            </Link>
          ))}
        </div>
      )}

      {summary && summary.totalFindings === 0 && (
        <p className="mt-6 text-sm text-ink-subtle">No findings yet — click "Run discovery" to scan for lookalike domains.</p>
      )}
    </div>
  );
}
