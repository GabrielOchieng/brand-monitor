"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Settings2 } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { describeTarget, fullDate, timeAgo } from "../../lib/format";
import { cn } from "../../lib/cn";
import { ACTION_STATUS_LABELS, ACTION_STATUS_TONE, BLOCKER_LABELS, CHANNEL_LABELS, KIND_LABELS } from "../../lib/autoTakedown";
import { PageHeader } from "../../components/ui/PageHeader";
import { Stat, StatStrip } from "../../components/ui/StatStrip";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/Tabs";
import { LoadingRegion, SkeletonList } from "../../components/Skeleton";
import { Ident, Pill, SEV_BG, SeverityTag } from "../../components/threat/atoms";
import { ReportPanel } from "../../components/takedown/ReportPanel";
import { duration, TakedownResults, type TakedownMetrics } from "../../components/TakedownResults";

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
  routing: { method?: string; forms?: Array<{ url: string; instructions: string | null }> } | null;
  updatedAt: string;
  finding: { id: string; identifier: string; type: string; severity: string; brand: { name: string } } | null;
}

interface Queue {
  counts: Record<string, number>;
  actions: QueueAction[];
}

interface AutomationOverview {
  blockers: string[];
}

// Tabs in the order an analyst works through them.
const TABS: Array<{ key: string; label: string; statuses: string[]; hideEmpty?: boolean }> = [
  { key: "approval", label: "Needs approval", statuses: ["awaiting_approval"] },
  { key: "soon", label: "Sending soon", statuses: ["pending_veto", "queued"] },
  { key: "manual", label: "Manual tasks", statuses: ["manual"] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
  { key: "test", label: "Test mode", statuses: ["shadow"], hideEmpty: true },
  { key: "sent", label: "Sent", statuses: ["sent"] },
  { key: "closed", label: "Cancelled", statuses: ["cancelled", "skipped"] },
  { key: "results", label: "Results", statuses: [] },
];

const WIDE = "(min-width: 1024px)";

function untilText(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "on the next run";
  const m = Math.round(ms / 60_000);
  return m < 60 ? `in ${m}m` : `in ${Math.floor(m / 60)}h ${m % 60}m`;
}

// What happens next with a report, in a few words, and how urgent it is.
function nextStep(a: QueueAction): { text: string; tone: string } {
  switch (a.status) {
    case "awaiting_approval":
      return { text: "Waiting for you", tone: "text-sev-medium" };
    case "pending_veto":
    case "queued":
      return { text: a.sendAfter ? `Sends ${untilText(a.sendAfter)}` : "Sends on the next run", tone: "text-foreground" };
    case "manual":
      return { text: "Fill in the form", tone: "text-sev-medium" };
    case "failed":
      return { text: a.bouncedAt ? "Bounced" : "Failed", tone: "text-sev-critical" };
    case "shadow":
      return { text: a.shadowVerdict === "right" ? "Reviewed: right" : a.shadowVerdict === "wrong" ? "Reviewed: wrong" : "Needs review", tone: a.shadowVerdict ? "text-subtle" : "text-sev-medium" };
    case "sent":
      if (a.bouncedAt) return { text: "Bounced", tone: "text-sev-critical" };
      if (a.replyCount > 0) return { text: `${a.replyCount} repl${a.replyCount === 1 ? "y" : "ies"}`, tone: "text-sev-medium" };
      return { text: a.sentAt ? `Sent ${timeAgo(a.sentAt)}` : "Sent", tone: "text-subtle" };
    default:
      return { text: a.skipReason ?? ACTION_STATUS_LABELS[a.status] ?? a.status, tone: "text-subtle" };
  }
}

// useSearchParams (the tab lives in the URL) needs a Suspense boundary on a static page.
export default function TakedownsPage() {
  return (
    <Suspense fallback={<SkeletonList rows={5} />}>
      <Takedowns />
    </Suspense>
  );
}

function Takedowns() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "approval";
  const current = TABS.find((t) => t.key === tab)!;
  const [data, setData] = useState<Queue | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [overview, setOverview] = useState<AutomationOverview | null>(null);
  const [metrics, setMetrics] = useState<TakedownMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const statuses = current.statuses.length ? current.statuses : ["awaiting_approval"];
      const lists = await Promise.all(statuses.map((s) => apiFetch<Queue>(`/api/takedown-queue?status=${s}`)));
      setCounts(lists[0].counts);
      if (current.statuses.length) setData({ counts: lists[0].counts, actions: lists.flatMap((l) => l.actions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [current]);

  useEffect(() => {
    setData(null);
    setPanel(null);
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<AutomationOverview>("/api/takedown-automation")
      .then(setOverview)
      .catch(() => setOverview(null));
    apiFetch<TakedownMetrics>("/api/takedown-metrics?days=30")
      .then(setMetrics)
      .catch(() => setMetrics(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && panel && !document.querySelector('[role="dialog"][data-state="open"]') && setPanel(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel]);

  const count = (statuses: string[]): number => statuses.reduce((a, s) => a + (counts?.[s] ?? 0), 0);
  const c = (s: string): number => counts?.[s] ?? 0;
  const waiting = c("awaiting_approval") + c("manual") + c("failed");
  const blockers = overview?.blockers ?? [];
  const tabs = TABS.filter((t) => !t.hideEmpty || count(t.statuses) > 0 || t.key === tab);

  function selectTab(key: string) {
    router.replace(key === "approval" ? "/takedowns" : `/takedowns?tab=${key}`, { scroll: false });
  }

  function open(a: QueueAction) {
    if (window.matchMedia(WIDE).matches) setPanel(a.id);
    else router.push(`/threats/${a.findingId}?tab=takedown&report=${a.id}`);
  }

  const selected = data?.actions.find((a) => a.id === panel) ?? null;

  return (
    <div>
      <PageHeader
        title="Takedowns"
        description="Every takedown report: waiting for you, about to send, sent and answered."
        actions={
          <Button asChild>
            <Link href="/settings?section=auto-takedown">
              <Settings2 />
              Sending settings
            </Link>
          </Button>
        }
      />

      <StatStrip label="Takedown summary" wideFirst={false}>
        <Stat label="Waiting for you" value={counts ? waiting : "–"} tone={waiting > 0 ? "text-sev-medium" : undefined}>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {[c("awaiting_approval") && `${c("awaiting_approval")} to approve`, c("manual") && `${c("manual")} form${c("manual") > 1 ? "s" : ""}`, c("failed") && `${c("failed")} failed`]
              .filter(Boolean)
              .join(" · ") || "Nothing to do"}
          </div>
        </Stat>
        <Stat label="Sending soon" value={counts ? c("pending_veto") + c("queued") : "–"}>
          <div className="mt-1.5 text-xs text-muted-foreground">You can still cancel these</div>
        </Stat>
        <Stat label="Sent" value={counts ? c("sent") : "–"} note="all time" />
        <Stat label="Taken down · 30 days" value={metrics ? metrics.total.completed : "–"}>
          <div className="mt-1.5 text-xs text-muted-foreground">{metrics ? (metrics.total.medianHoursToTakedown != null ? `Median ${duration(metrics.total.medianHoursToTakedown)} to take down` : "None taken down yet") : " "}</div>
        </Stat>
      </StatStrip>

      {blockers.length > 0 && (
        <Banner
          tone="warn"
          className="mb-3.5"
          title="Automatic sending is off."
          action={
            <Link href="/settings?section=auto-takedown" className="whitespace-nowrap text-primary hover:underline">
              Finish setup →
            </Link>
          }
        >
          Reports are prepared for you and wait under Needs approval. {blockers.length === 1 ? BLOCKER_LABELS[blockers[0]] ?? "" : `${blockers.length} setup steps are left.`}
        </Banner>
      )}

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="mb-3">
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key} count={t.statuses.length && counts ? count(t.statuses) : undefined}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      {tab === "results" ? (
        <TakedownResults />
      ) : !data ? (
        <LoadingRegion label="Loading the takedown queue">
          <SkeletonList rows={5} />
        </LoadingRegion>
      ) : data.actions.length === 0 ? (
        <EmptyState title="Nothing here">
          {tab === "approval" ? "No report is waiting for approval. New ones appear here when a confirmed threat qualifies, or when you prepare one on a threat's Takedown tab." : "No reports in this state."}
        </EmptyState>
      ) : (
        <div className={cn("grid grid-cols-1", selected && "lg:grid-cols-[minmax(0,1fr)_minmax(400px,48%)]")}>
          <div className="min-w-0">
            <div className={cn("hidden overflow-x-auto rounded-md border border-border bg-card md:block", selected && "lg:rounded-r-none")}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    {["Report", "Threat", "Channel", ...(selected ? [] : ["To"]), "Next", ...(selected ? [] : ["Updated"])].map((h) => (
                      <th key={h} className="whitespace-nowrap border-b border-border bg-raised px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] text-subtle">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.actions.map((a) => {
                    const n = nextStep(a);
                    return (
                      <tr key={a.id} onClick={() => open(a)} className={cn("cursor-pointer border-b border-border last:border-b-0 hover:bg-hover", panel === a.id && "bg-primary-soft hover:bg-primary-soft")}>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="font-mono text-xs text-subtle">{a.reportRef}</span>
                          <small className="block text-[11px] text-subtle">{a.createdAuto ? "automatic" : "by hand"}</small>
                        </td>
                        <td className="min-w-[200px] px-3 py-2">
                          {a.finding ? <Ident value={describeTarget(a.finding.identifier, a.finding.type).primary} highlight={a.finding.type !== "social"} /> : <span className="text-subtle">deleted threat</span>}
                          {a.finding && (
                            <small className="mt-0.5 flex items-center gap-2 text-[11px] text-subtle">
                              <SeverityTag severity={a.finding.severity} className="text-[10px]" />
                              {a.finding.brand.name}
                            </small>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {CHANNEL_LABELS[a.channel] ?? a.channel}
                          <small className="block text-[11px] text-subtle">{KIND_LABELS[a.kind] ?? a.kind}</small>
                        </td>
                        {!selected && (
                          <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs text-subtle" title={a.to.join(", ")}>
                            {a.routing?.method === "api" ? "Cloudflare API" : a.to.length ? a.to.join(", ") : "nobody yet"}
                          </td>
                        )}
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className={cn("text-[12.5px]", n.tone)}>{n.text}</span>
                          {a.redirected && <small className="block text-[11px] text-subtle">test mode</small>}
                        </td>
                        {!selected && (
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-subtle" title={fullDate(a.updatedAt)}>
                            {timeAgo(a.updatedAt)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="flex flex-col rounded-md border border-border bg-card md:hidden">
              {data.actions.map((a) => {
                const n = nextStep(a);
                return (
                  <li key={a.id} className="border-b border-border last:border-b-0">
                    <Link href={`/threats/${a.findingId}?tab=takedown&report=${a.id}`} className="grid grid-cols-[4px_minmax(0,1fr)] gap-2.5 py-2.5 pl-2.5 pr-3">
                      <span className={cn("self-stretch rounded-sm", a.finding ? SEV_BG[a.finding.severity] : "bg-border")} aria-hidden="true" />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-baseline justify-between gap-2">
                          {a.finding ? <Ident value={describeTarget(a.finding.identifier, a.finding.type).primary} className="min-w-0" /> : <span className="text-subtle">deleted threat</span>}
                          <span className="shrink-0 font-mono text-xs text-subtle">{a.reportRef}</span>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                          <Pill tone={ACTION_STATUS_TONE[a.status]}>{ACTION_STATUS_LABELS[a.status] ?? a.status}</Pill>
                          <span>{CHANNEL_LABELS[a.channel] ?? a.channel}</span>
                          <span className={n.tone}>{n.text}</span>
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          {selected && (
            <div className="hidden min-w-0 lg:block">
              <ReportPanel
                key={selected.id}
                actionId={selected.id}
                findingId={selected.findingId}
                finding={selected.finding}
                shadowVerdict={selected.shadowVerdict}
                onClose={() => setPanel(null)}
                onChanged={load}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
