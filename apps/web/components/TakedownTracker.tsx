"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { TakedownStatusSchema } from "@brand-monitor/shared";
import { apiFetch } from "../lib/api";

const TAKEDOWN_STATUSES = TakedownStatusSchema.options;

interface Takedown {
  id: string;
  provider: string;
  reference: string | null;
  status: (typeof TAKEDOWN_STATUSES)[number];
  notes: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

export function TakedownTracker({ findingId }: { findingId: string }) {
  const { getToken } = useAuth();
  const [takedowns, setTakedowns] = useState<Takedown[]>([]);
  const [form, setForm] = useState({ provider: "", reference: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const data = await apiFetch<Takedown[]>(`/api/findings/${findingId}/takedowns`, token);
    setTakedowns(data);
  }, [getToken, findingId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.provider.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      await apiFetch(`/api/findings/${findingId}/takedowns`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: form.provider,
          reference: form.reference || undefined,
          notes: form.notes || undefined,
        }),
      });
      setForm({ provider: "", reference: "", notes: "" });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // A takedown record is closer to a compliance log than a UI preference, so unlike
  // FindingLifecycle's status/assignee selects (which set state before the PATCH
  // resolves and never roll back), this reverts the dropdown to its prior value on a
  // failed save rather than leaving a stale-looking-correct value on screen.
  async function handleStatusChange(takedownId: string, previousStatus: string, nextStatus: string) {
    setTakedowns((prev) => prev.map((t) => (t.id === takedownId ? { ...t, status: nextStatus as Takedown["status"] } : t)));
    setError(null);
    try {
      const token = await getToken();
      const updated = await apiFetch<Takedown>(`/api/findings/${findingId}/takedowns/${takedownId}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      setTakedowns((prev) => prev.map((t) => (t.id === takedownId ? updated : t)));
    } catch (err: any) {
      setError(err.message);
      setTakedowns((prev) => prev.map((t) => (t.id === takedownId ? { ...t, status: previousStatus as Takedown["status"] } : t)));
    }
  }

  return (
    <section className="card mt-6 p-5">
      <h2 className="label">Takedown requests</h2>

      <ul className="mt-3 space-y-2">
        {takedowns.map((t) => (
          <li key={t.id} className="rounded-md border border-line bg-surface px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="font-medium text-ink">{t.provider}</span>
                {t.reference && <span className="ml-2 text-ink-subtle">Ref: {t.reference}</span>}
              </div>
              <select
                value={t.status}
                onChange={(e) => handleStatusChange(t.id, t.status, e.target.value)}
                className="field-sm"
              >
                {TAKEDOWN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            {t.notes && <p className="mt-1 text-ink-muted">{t.notes}</p>}
            <div className="mt-1 text-xs text-ink-faint">
              Requested {new Date(t.requestedAt).toLocaleString()}
              {t.resolvedAt && ` · Resolved ${new Date(t.resolvedAt).toLocaleString()}`}
            </div>
          </li>
        ))}
        {takedowns.length === 0 && <li className="text-sm text-ink-subtle">No takedown requests logged yet.</li>}
      </ul>

      <form onSubmit={handleCreate} className="mt-4 grid gap-2 sm:grid-cols-3">
        <input
          placeholder="Provider (e.g. registrar)"
          value={form.provider}
          onChange={(e) => setForm({ ...form, provider: e.target.value })}
          className="field"
        />
        <input
          placeholder="Reference / ticket # (optional)"
          value={form.reference}
          onChange={(e) => setForm({ ...form, reference: e.target.value })}
          className="field"
        />
        <div className="flex gap-2">
          <input
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="field flex-1"
          />
          <button type="submit" disabled={submitting} className="btn-primary shrink-0">
            Log
          </button>
        </div>
      </form>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
