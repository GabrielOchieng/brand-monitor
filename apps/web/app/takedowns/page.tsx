"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { timeAgo, fullDate } from "../../lib/format";
import { useMyRole } from "../../lib/useMyRole";
import { ACTION_STATUS_LABELS, ACTION_STATUS_TONE, CHANNEL_LABELS, KIND_LABELS } from "../../lib/autoTakedown";
import { LoadingRegion, SkeletonList } from "../../components/Skeleton";
import { SeverityBadge } from "../../components/SeverityBadge";

interface QueueAction {
  id: string;
  findingId: string;
  channel: string;
  kind: string;
  status: string;
  reportRef: string;
  to: string[];
  subject: string;
  createdAuto: boolean;
  sendAfter: string | null;
  sentAt: string | null;
  holdReason: string | null;
  skipReason: string | null;
  error: string | null;
  redirected: boolean;
  shadowVerdict: string | null;
  replyCount: number;
  ticketRef: string | null;
  bouncedAt: string | null;
  routing: { forms?: Array<{ url: string; instructions: string | null }> } | null;
  updatedAt: string;
  finding: { id: string; identifier: string; type: string; severity: string; brand: { name: string } } | null;
}

interface Queue {
  counts: Record<string, number>;
  actions: QueueAction[];
}

// Tabs in the order an analyst works through them.
const TABS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "awaiting_approval", label: "Needs approval", statuses: ["awaiting_approval"] },
  { key: "pending_veto", label: "Veto window", statuses: ["pending_veto", "queued"] },
  { key: "manual", label: "Manual tasks", statuses: ["manual"] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
  { key: "shadow", label: "Shadow review", statuses: ["shadow"] },
  { key: "sent", label: "Sent", statuses: ["sent"] },
  { key: "closed", label: "Cancelled / skipped", statuses: ["cancelled", "skipped"] },
];

// The takedown queue: every report the organization has, across findings (TAKEDOWN_AUTOMATION_PLAN.md §9).
export default function TakedownQueuePage() {
  const role = useMyRole();
  const canAct = role === "owner" || role === "admin" || role === "analyst";
  const [tab, setTab] = useState(TABS[0].key);
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const current = TABS.find((t) => t.key === tab)!;

  const load = useCallback(async () => {
    try {
      const lists = await Promise.all(current.statuses.map((s) => apiFetch<Queue>(`/api/takedown-queue?status=${s}`)));
      setData({ counts: lists[0].counts, actions: lists.flatMap((l) => l.actions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    } catch (err: any) {
      setError(err.message);
    }
  }, [current]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  async function act(id: string, path: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const r = await apiFetch<{ status?: string; detail?: string }>(`/api/takedown-actions/${id}/${path}`, {
        method: "POST",
        ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (r?.status === "sent") setNotice("Sent.");
      else if (r?.status) setNotice(`${r.status === "held" ? "On hold" : r.status === "skipped" ? "Skipped" : r.status === "failed" ? "Failed" : r.status}${r.detail ? `: ${r.detail}` : ""}`);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const count = (t: (typeof TABS)[number]) => t.statuses.reduce((a, s) => a + (data?.counts[s] ?? 0), 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Takedowns</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-subtle">
        Every takedown report your organization has, automatic or prepared by hand. Settings for when reports are made and sent are under{" "}
        <Link href="/settings?section=auto-takedown" className="text-brand hover:underline">
          Settings → Automatic reporting
        </Link>
        .
      </p>

      <div className="mt-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-brand font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {t.label}
            {data && count(t) > 0 && <span className="ml-1.5 rounded-full bg-elevated px-1.5 text-xs text-ink-muted">{count(t)}</span>}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-3 text-sm text-ink-muted">{notice}</p>}

      {!data ? (
        <LoadingRegion label="Loading the takedown queue" className="mt-4">
          <SkeletonList rows={5} />
        </LoadingRegion>
      ) : data.actions.length === 0 ? (
        <div className="card mt-4 p-8 text-center text-sm text-ink-subtle">Nothing here.</div>
      ) : (
        <ul className="mt-4 space-y-2">
          {data.actions.map((a) => (
            <li key={a.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {a.finding && <SeverityBadge severity={a.finding.severity} />}
                    <Link href={`/threats/${a.findingId}`} className="truncate font-medium text-ink hover:underline">
                      {a.finding?.identifier ?? "deleted finding"}
                    </Link>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${ACTION_STATUS_TONE[a.status] ?? ""}`}>{ACTION_STATUS_LABELS[a.status] ?? a.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {CHANNEL_LABELS[a.channel] ?? a.channel} · {KIND_LABELS[a.kind] ?? a.kind} · <span className="font-mono">{a.reportRef}</span> · {a.createdAuto ? "automatic" : "by hand"}
                    {a.finding ? ` · ${a.finding.brand.name}` : ""}
                  </div>
                  <div className="mt-1 break-all text-xs text-ink-subtle">To: {a.to.length ? a.to.join(", ") : "nobody yet"}</div>
                  {a.status === "pending_veto" && a.sendAfter && <div className="mt-1 text-xs text-sky-800">Goes out {new Date(a.sendAfter) > new Date() ? `at ${fullDate(a.sendAfter)}` : "on the next run"} unless cancelled.</div>}
                  {a.holdReason && <div className="mt-1 text-xs text-amber-800">On hold: {a.holdReason}</div>}
                  {a.skipReason && <div className="mt-1 text-xs text-ink-subtle">Skipped: {a.skipReason}</div>}
                  {a.error && <div className="mt-1 text-xs text-red-700">{a.error}</div>}
                  {a.sentAt && (
                    <div className="mt-1 text-xs text-ink-subtle">
                      Sent {timeAgo(a.sentAt)}
                      {a.redirected ? " (redirect mode: to your test address)" : ""}
                      {a.replyCount > 0 ? ` · ${a.replyCount} repl${a.replyCount === 1 ? "y" : "ies"}` : ""}
                      {a.ticketRef ? ` · their ticket ${a.ticketRef}` : ""}
                      {a.bouncedAt ? " · bounced" : ""}
                    </div>
                  )}
                  {a.status === "manual" &&
                    a.routing?.forms?.map((f) => (
                      <div key={f.url} className="mt-1 text-xs">
                        <a href={f.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                          {f.url}
                        </a>
                        {f.instructions ? <span className="text-ink-subtle"> · {f.instructions}</span> : null}
                      </div>
                    ))}
                </div>
                {canAct && (
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {["awaiting_approval", "pending_veto", "queued", "failed"].includes(a.status) && (
                      <button
                        className="btn-primary text-xs"
                        disabled={busy === a.id || a.to.length === 0}
                        onClick={() => act(a.id, "send", undefined, `Send this report to ${a.to.join(", ")} now?`)}
                      >
                        {a.status === "failed" ? "Retry" : a.status === "awaiting_approval" ? "Approve and send" : "Send now"}
                      </button>
                    )}
                    {a.status === "manual" && (
                      <button
                        className="btn-secondary text-xs"
                        disabled={busy === a.id}
                        onClick={() => {
                          const reference = window.prompt("Reported it through the form? Ticket or case number, if you got one (optional):");
                          if (reference !== null) act(a.id, "mark-reported", { provider: `${CHANNEL_LABELS[a.channel] ?? a.channel} (web form)`, reference });
                        }}
                      >
                        Mark as reported
                      </button>
                    )}
                    {a.status === "shadow" && (
                      <>
                        <button className={a.shadowVerdict === "right" ? "btn-primary text-xs" : "btn-secondary text-xs"} disabled={busy === a.id} onClick={() => act(a.id, "verdict", { verdict: a.shadowVerdict === "right" ? null : "right" })}>
                          Right
                        </button>
                        <button className={a.shadowVerdict === "wrong" ? "btn-danger text-xs" : "btn-secondary text-xs"} disabled={busy === a.id} onClick={() => act(a.id, "verdict", { verdict: a.shadowVerdict === "wrong" ? null : "wrong" })}>
                          Wrong
                        </button>
                      </>
                    )}
                    {["awaiting_approval", "pending_veto", "queued", "manual", "failed", "shadow"].includes(a.status) && (
                      <button className="btn-ghost text-xs text-red-600" disabled={busy === a.id} onClick={() => act(a.id, "cancel", undefined, "Cancel this report? It won't be made again automatically.")}>
                        Cancel
                      </button>
                    )}
                    <Link href={`/threats/${a.findingId}#report-drafts`} className="btn-ghost text-xs">
                      Open
                    </Link>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
