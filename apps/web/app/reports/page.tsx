"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../../lib/api";
import { SeverityBadge } from "../../components/SeverityBadge";

interface Brand {
  id: string;
  name: string;
  reportToken: string | null;
}

interface FindingRef {
  id: string;
  identifier: string;
  severity: string;
}

interface Report {
  id: string;
  brandId: string;
  url: string | null;
  phone: string | null;
  description: string | null;
  reporterEmail: string | null;
  status: string;
  scanQueued: boolean;
  createdAt: string;
  finding: FindingRef | null;
  matchedFindings: FindingRef[];
}

const STATUS_FILTERS = ["new", "reviewed", "dismissed", ""] as const;

// Scam reports from the public form (/report/<token>), plus the controls for that link.
export default function ReportsPage() {
  const { getToken } = useAuth();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("new");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const token = await getToken();
    const [b, r] = await Promise.all([
      apiFetch<Brand[]>("/api/brands", token),
      apiFetch<Report[]>(`/api/reports${status ? `?status=${status}` : ""}`, token),
    ]);
    setBrands(b);
    setReports(r);
    setLoading(false);
  }, [getToken, status]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: (token: string | null) => Promise<unknown>) {
    setError("");
    try {
      await fn(await getToken());
      await load();
    } catch (e: any) {
      setError(String(e?.message ?? e).includes("403") ? "Only owners and admins can change the public link." : String(e?.message ?? e));
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Public reports</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Scams reported by customers and staff through the public form. Links are scanned automatically (up to 30 a day per
        brand); phone numbers are matched against contact details found on existing findings.
      </p>

      <section className="card mt-6 p-5">
        <h2 className="label">Public report link</h2>
        {brands.map((b) => (
          <div key={b.id} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-ink">{b.name}</span>
            {b.reportToken ? (
              <>
                <input readOnly value={`${origin}/report/${b.reportToken}`} className="field-sm min-w-0 flex-1 font-mono" onFocus={(e) => e.currentTarget.select()} />
                <button className="btn-ghost text-xs" onClick={() => navigator.clipboard.writeText(`${origin}/report/${b.reportToken}`)}>
                  Copy
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => confirm("Rotate the link? The current one stops working everywhere it's been shared.") && act((t) => apiFetch(`/api/brands/${b.id}/report-token`, t, { method: "POST" }))}
                >
                  Rotate
                </button>
                <button
                  className="btn-danger text-xs"
                  onClick={() => confirm("Turn off the public form for this brand?") && act((t) => apiFetch(`/api/brands/${b.id}/report-token`, t, { method: "DELETE" }))}
                >
                  Turn off
                </button>
              </>
            ) : (
              <button className="btn-secondary text-xs" onClick={() => act((t) => apiFetch(`/api/brands/${b.id}/report-token`, t, { method: "POST" }))}>
                Create link
              </button>
            )}
          </div>
        ))}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      <div className="mt-6 flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <button key={s || "all"} onClick={() => setStatus(s)} className={status === s ? "btn-secondary text-xs" : "btn-ghost text-xs"}>
            {s ? s[0].toUpperCase() + s.slice(1) : "All"}
          </button>
        ))}
      </div>

      {loading && <p className="mt-4 text-sm text-ink-subtle">Loading…</p>}

      <div className="card mt-3 divide-y divide-line">
        {reports.map((r) => (
          <div key={r.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                {r.url && <div className="break-all font-mono text-ink">{r.url}</div>}
                {r.phone && <div className="font-mono text-ink">{r.phone}</div>}
                {r.description && <p className="whitespace-pre-wrap text-ink-muted">{r.description}</p>}
                <div className="text-xs text-ink-subtle">
                  {new Date(r.createdAt).toLocaleString()}
                  {r.reporterEmail && <> · reporter: {r.reporterEmail}</>}
                  {r.url && !r.finding && <> · not scanned (daily cap reached, or the brand&apos;s own site / a contact link)</>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                {r.status !== "reviewed" && (
                  <button className="btn-ghost text-xs" onClick={() => act((t) => apiFetch(`/api/reports/${r.id}`, t, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "reviewed" }) }))}>
                    Mark reviewed
                  </button>
                )}
                {r.status !== "dismissed" && (
                  <button className="btn-ghost text-xs" onClick={() => act((t) => apiFetch(`/api/reports/${r.id}`, t, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "dismissed" }) }))}>
                    Dismiss
                  </button>
                )}
              </div>
            </div>
            {(r.finding || r.matchedFindings.length > 0) && (
              <ul className="mt-2 space-y-1 text-xs">
                {[...(r.finding ? [{ ...r.finding, why: "reported link" }] : []), ...r.matchedFindings.map((f) => ({ ...f, why: "same contact details" }))].map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <span className="text-ink-subtle">{f.why}:</span>
                    <Link href={`/threats/${f.id}`} className="break-all font-mono text-ink hover:text-brand-hover">
                      {f.identifier}
                    </Link>
                    <SeverityBadge severity={f.severity} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {!loading && reports.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink-subtle">No reports here.</div>}
      </div>
    </div>
  );
}
