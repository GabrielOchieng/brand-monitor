"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { CHANNEL_LABELS } from "../lib/autoTakedown";
import { LoadingRegion, SkeletonTable } from "./Skeleton";
import { Panel, PanelHeader } from "./ui/Panel";
import { Stat, StatStrip } from "./ui/StatStrip";
import { Banner } from "./ui/Banner";
import { cn } from "../lib/cn";

interface Bucket {
  key: string;
  sent: number;
  acknowledged: number;
  completed: number;
  rejected: number;
  medianHoursToReply: number | null;
  medianHoursToTakedown: number | null;
}

export interface TakedownMetrics {
  days: number;
  total: Bucket;
  byChannel: Bucket[];
  byRegistrar: Bucket[];
  byHost: Bucket[];
}

const pct = (n: number, d: number): string => (d ? `${Math.round((n / d) * 100)}%` : "–");

export function duration(h: number | null): string {
  if (h === null) return "–";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

function Table({ title, rows, label }: { title: string; rows: Bucket[]; label: (k: string) => string }) {
  const th = "whitespace-nowrap border-b border-border bg-raised px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-subtle";
  return (
    <Panel>
      <PanelHeader title={title} />
      {rows.length === 0 ? (
        <p className="p-3.5 text-[13px] text-subtle">No reports sent in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={cn(th, "text-left")}>Recipient</th>
                <th className={cn(th, "text-right")}>Sent</th>
                <th className={cn(th, "text-right")}>Answered</th>
                <th className={cn(th, "text-left")}>Taken down</th>
                <th className={cn(th, "text-right")}>Rejected</th>
                <th className={cn(th, "text-right")}>First reply</th>
                <th className={cn(th, "text-right")}>To takedown</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.key} className="border-b border-border last:border-b-0">
                  <td className="max-w-[16rem] truncate px-3 py-2" title={label(b.key)}>
                    {label(b.key)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular">{b.sent}</td>
                  <td className="px-3 py-2 text-right font-mono tabular text-muted-foreground">
                    {b.acknowledged} <span className="text-subtle">{pct(b.acknowledged, b.sent)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2.5">
                      <span className="w-5 font-mono tabular">{b.completed}</span>
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-border-strong" aria-hidden="true">
                        <span className="block h-full bg-ok" style={{ width: `${b.sent ? (b.completed / b.sent) * 100 : 0}%` }} />
                      </span>
                      <span className="text-xs text-subtle">{pct(b.completed, b.sent)}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular text-muted-foreground">{b.rejected}</td>
                  <td className="px-3 py-2 text-right tabular text-muted-foreground">{duration(b.medianHoursToReply)}</td>
                  <td className={cn("px-3 py-2 text-right tabular", b.completed === 0 ? "text-subtle" : "text-muted-foreground")}>{duration(b.medianHoursToTakedown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const PERIODS = [
  [30, "30 days"],
  [90, "90 days"],
  [365, "12 months"],
] as const;

// Takedowns -> Results: how sent reports fared, from the org's own reports and replies only.
export function TakedownResults() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<TakedownMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    apiFetch<TakedownMetrics>(`/api/takedown-metrics?days=${days}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [days]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          Reports sent to real recipients (not test-mode ones) and what happened: answered (a reply, or the log says acknowledged), taken down, and how long it took. See which
          registrars and hosts act.
        </p>
        <div className="inline-flex overflow-hidden rounded-md border border-border-strong" role="radiogroup" aria-label="Period">
          {PERIODS.map(([d, l]) => (
            <label key={d} className={cn("cursor-pointer border-l border-border-strong px-3 py-1.5 text-[12.5px] text-muted-foreground first:border-l-0", days === d && "bg-primary-soft text-foreground")}>
              <input type="radio" name="results-period" className="sr-only" checked={days === d} onChange={() => setDays(d)} />
              {l}
            </label>
          ))}
        </div>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {!data ? (
        <LoadingRegion label="Loading results">
          <SkeletonTable rows={4} />
        </LoadingRegion>
      ) : (
        <>
          <StatStrip label="Results" wideFirst={false} className="mb-0">
            <Stat label="Reports sent" value={data.total.sent} />
            <Stat label="Answered" value={data.total.acknowledged} note={pct(data.total.acknowledged, data.total.sent)}>
              <div className="mt-1.5 text-xs text-muted-foreground">Median first reply {duration(data.total.medianHoursToReply)}</div>
            </Stat>
            <Stat label="Taken down" value={data.total.completed} note={pct(data.total.completed, data.total.sent)} />
            <Stat label="Median to takedown" value={duration(data.total.medianHoursToTakedown)} />
          </StatStrip>
          <Table title="By channel" rows={data.byChannel} label={(k) => CHANNEL_LABELS[k] ?? k} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Table title="By registrar" rows={data.byRegistrar} label={(k) => k} />
            <Table title="By hosting provider" rows={data.byHost} label={(k) => k} />
          </div>
        </>
      )}
    </div>
  );
}
