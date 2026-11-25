"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { CHANNEL_LABELS } from "../lib/autoTakedown";
import { LoadingRegion, SkeletonTable } from "./Skeleton";

interface Bucket {
  key: string;
  sent: number;
  acknowledged: number;
  completed: number;
  rejected: number;
  medianHoursToReply: number | null;
  medianHoursToTakedown: number | null;
}

interface Metrics {
  days: number;
  total: Bucket;
  byChannel: Bucket[];
  byRegistrar: Bucket[];
  byHost: Bucket[];
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");
function duration(h: number | null): string {
  if (h === null) return "–";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

function Table({ title, rows, label }: { title: string; rows: Bucket[]; label: (k: string) => string }) {
  return (
    <section className="card overflow-hidden">
      <h3 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-subtle">No reports sent in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-2 font-medium">Recipient</th>
                <th className="px-4 py-2 text-right font-medium">Sent</th>
                <th className="px-4 py-2 text-right font-medium">Answered</th>
                <th className="px-4 py-2 text-right font-medium">Taken down</th>
                <th className="px-4 py-2 text-right font-medium">Rejected</th>
                <th className="px-4 py-2 text-right font-medium">Median first reply</th>
                <th className="px-4 py-2 text-right font-medium">Median to takedown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((b) => (
                <tr key={b.key}>
                  <td className="max-w-[16rem] truncate px-4 py-2 text-ink" title={label(b.key)}>
                    {label(b.key)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">{b.sent}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                    {b.acknowledged} <span className="text-ink-subtle">({pct(b.acknowledged, b.sent)})</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-muted">
                    {b.completed} <span className="text-ink-subtle">({pct(b.completed, b.sent)})</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{b.rejected}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{duration(b.medianHoursToReply)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{duration(b.medianHoursToTakedown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Takedowns -> Results: how sent reports fared, from the org's own reports and replies only.
export function TakedownResults() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    apiFetch<Metrics>(`/api/takedown-metrics?days=${days}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [days]);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-subtle">
          Reports sent to real recipients (not redirect-mode tests) and what happened: answered (a reply or the tracker says acknowledged), taken down (the tracker
          says completed, e.g. the site was confirmed down), and how long it took. Use it to see which registrars and hosts act.
        </p>
        <select className="field" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 12 months</option>
        </select>
      </div>
      {error && <p className="text-sm text-sev-critical">{error}</p>}
      {!data ? (
        <LoadingRegion label="Loading results">
          <SkeletonTable rows={4} />
        </LoadingRegion>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Reports sent", String(data.total.sent)],
              ["Answered", `${data.total.acknowledged} (${pct(data.total.acknowledged, data.total.sent)})`],
              ["Taken down", `${data.total.completed} (${pct(data.total.completed, data.total.sent)})`],
              ["Median to takedown", duration(data.total.medianHoursToTakedown)],
            ].map(([k, v]) => (
              <div key={k} className="card px-4 py-3">
                <div className="text-xs text-ink-subtle">{k}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{v}</div>
              </div>
            ))}
          </div>
          <Table title="By channel" rows={data.byChannel} label={(k) => CHANNEL_LABELS[k] ?? k} />
          <Table title="By registrar" rows={data.byRegistrar} label={(k) => k} />
          <Table title="By hosting provider" rows={data.byHost} label={(k) => k} />
        </>
      )}
    </div>
  );
}
