"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Clock, Plus, Radar, Search, X } from "lucide-react";
import { useSession } from "../../lib/session";
import { useBrands } from "../../lib/brand";
import { apiFetch, API_URL } from "../../lib/api";
import { describeTarget, fullDate, sourceLabel, timeAgo } from "../../lib/format";
import { cn } from "../../lib/cn";
import { PageHeader } from "../../components/ui/PageHeader";
import { Panel, PanelHeader } from "../../components/ui/Panel";
import { Stat, StatStrip } from "../../components/ui/StatStrip";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Field, Input } from "../../components/ui/Field";
import { Dialog, DialogContent, DialogFooter } from "../../components/ui/Dialog";
import { useToast } from "../../components/ui/Toast";
import { Ident, SEV_BG, SEV_TEXT, SeverityTag, WebState } from "../../components/threat/atoms";
import { Sparkline } from "../../components/overview/Sparkline";
import { DashboardSkeleton } from "../../components/PageSkeletons";
import { LoadingRegion, Skeleton } from "../../components/Skeleton";

interface AttentionItem {
  id: string;
  identifier: string;
  type: string;
  source: string;
  severity: string;
  riskScore: number;
  status: string;
  firstDetectedAt: string;
  webState: "live" | "parked" | "offline" | null;
  topReason: string | null;
}

interface Summary {
  brand: { id: string; name: string; primaryDomain: string; hasVisualBaseline: boolean };
  openBySeverity: Record<string, number>;
  openTotal: number;
  newThisWeek: number;
  newPerDay: number[];
  liveOpen: number;
  takedownsDone: { last30Days: number; medianDays: number | null };
  attention: AttentionItem[];
  openTakedowns: Array<{ id: string; provider: string; status: string; requestedAt: string; finding: { id: string; identifier: string; type: string } }>;
  openTakedownCount: number;
}

interface RunStatus {
  id: string;
  status: "running" | "completed" | "failed";
  candidatesTotal: number;
  candidatesChecked: number;
  findingsCreated: number;
  error: string | null;
}

interface Health {
  sources: Record<string, { lastSuccessAt: string | null; stale: boolean }>;
  tavilyUsage: { period: string; used: number; cap: number } | null;
}

interface NotificationItem {
  id: string;
  findingId: string | null;
  link: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

const SOURCE_NAMES: Record<string, string> = {
  ct_log: "Certificate logs",
  nrd: "New-domain feed",
  nrd_hagezi: "New-domain feed (hagezi)",
  isc_recent: "New domains (SANS ISC)",
  phish_feed: "Phishing feed",
  google_play: "Google Play",
  social_search: "Social and web search",
};

export default function OverviewPage() {
  const { orgId, isLoaded, me, role } = useSession();
  const { brands, selected, select, reload: reloadBrands } = useBrands();
  const toast = useToast();
  const canAct = !me?.adminView && (role === "owner" || role === "admin" || role === "analyst");
  const activeOrgPaused = !!me?.organizations.find((o) => o.id === orgId)?.monitoringPaused;

  const [summary, setSummary] = useState<Summary | null>(null);
  const [queueCounts, setQueueCounts] = useState<Record<string, number> | null>(null);
  const [health, setHealth] = useState<Health | null | "unavailable">(null);
  const [activity, setActivity] = useState<NotificationItem[] | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "starting" | "queued">("idle");
  const [reportOpen, setReportOpen] = useState(false);
  const [handled, setHandled] = useState<Record<string, string>>({});

  const brandId = selected?.id ?? null;

  const loadSummary = useCallback(async (id: string) => {
    try {
      setSummary(await apiFetch<Summary>(`/api/dashboard/summary?brandId=${encodeURIComponent(id)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!brandId) return;
    setSummary(null);
    setRun(null);
    setSearchState("idle");
    setHandled({});
    loadSummary(brandId);
  }, [brandId, loadSummary]);

  // Org-wide, so loaded once: detection-source health (public endpoint), recent activity, and the
  // takedown queue's counts for "waiting for you".
  useEffect(() => {
    if (!isLoaded || !orgId) return;
    fetch(`${API_URL}/health/jobs`, { cache: "no-store" })
      .then((r) => r.json())
      .then((h: Health) => setHealth(h))
      .catch(() => setHealth("unavailable"));
    apiFetch<{ notifications: NotificationItem[] }>("/api/notifications")
      .then((d) => setActivity(d.notifications.slice(0, 6)))
      .catch(() => setActivity([]));
    apiFetch<{ counts: Record<string, number> }>("/api/takedown-queue?status=awaiting_approval")
      .then((d) => setQueueCounts(d.counts))
      .catch(() => setQueueCounts({}));
  }, [isLoaded, orgId]);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    const interval = setInterval(async () => {
      try {
        const updated = await apiFetch<RunStatus>(`/api/pipeline/runs/${run.id}`);
        setRun(updated);
        if (updated.status !== "running") {
          clearInterval(interval);
          if (brandId) loadSummary(brandId);
        }
      } catch {
        // Transient: the next tick retries.
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [run, brandId, loadSummary]);

  async function runDiscovery() {
    if (!brandId) return;
    setError(null);
    try {
      const { runId } = await apiFetch<{ runId: string }>("/api/pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      setRun({ id: runId, status: "running", candidatesTotal: 0, candidatesChecked: 0, findingsCreated: 0, error: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runSearch() {
    if (!brandId) return;
    setError(null);
    setSearchState("starting");
    try {
      await apiFetch("/api/pipeline/social-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      setSearchState("queued");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSearchState("idle");
    }
  }

  async function setStatus(item: AttentionItem, status: "confirmed" | "false_positive") {
    const prev = item.status;
    setHandled((h) => ({ ...h, [item.id]: status }));
    try {
      await apiFetch(`/api/findings/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      toast({
        message: `${status === "confirmed" ? "Confirmed" : "Dismissed as false positive:"} ${describeTarget(item.identifier, item.type).primary}`,
        action: {
          label: "Undo",
          onClick: async () => {
            await apiFetch(`/api/findings/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: prev }) }).catch(() => undefined);
            setHandled((h) => {
              const next = { ...h };
              delete next[item.id];
              return next;
            });
          },
        },
      });
    } catch (err) {
      setHandled((h) => {
        const next = { ...h };
        delete next[item.id];
        return next;
      });
      toast({ message: err instanceof Error ? err.message : "Couldn't update the threat.", tone: "error" });
    }
  }

  if (!isLoaded) return <DashboardSkeleton />;

  if (!orgId) {
    return (
      <Panel className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">No organization selected</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Pick one from the account menu in the top bar. If it lists none, you&apos;re not a member of any organization yet: ask its owner or admin to invite you.
        </p>
      </Panel>
    );
  }

  if (brands && brands.length === 0) {
    return (
      <FirstBrand
        onCreated={async (id) => {
          await reloadBrands();
          select(id);
        }}
      />
    );
  }

  if (!summary) return error ? <Banner tone="error">{error}</Banner> : <DashboardSkeleton />;

  const runPct = run && run.candidatesTotal > 0 ? Math.round((run.candidatesChecked / run.candidatesTotal) * 100) : 0;
  const prevWeek = summary.newPerDay.slice(0, 7).reduce((a, b) => a + b, 0);
  const queue = summary.attention.filter((f) => !handled[f.id]);
  const approvals = queueCounts?.awaiting_approval ?? 0;
  const manual = queueCounts?.manual ?? 0;
  const failed = queueCounts?.failed ?? 0;
  const waiting = queue.length + approvals + manual + failed;
  const sourceEntries = health && health !== "unavailable" ? Object.entries(health.sources) : [];
  const healthy = sourceEntries.filter(([, s]) => !s.stale).length;

  return (
    <div>
      {selected?.monitoringPausedAt && !activeOrgPaused && (
        <Banner tone="warn" className="mb-4" title={`Monitoring of ${selected.name} is paused by the platform admin.`}>
          Its threats are still here, but nothing new is found or scanned.
        </Banner>
      )}

      <PageHeader
        title="Overview"
        description={
          <>
            {summary.brand.name} · <span className="font-mono text-xs">{summary.brand.primaryDomain}</span>
          </>
        }
        actions={
          canAct && (
            <>
              <Button onClick={runDiscovery} disabled={run?.status === "running"}>
                <Radar />
                {run?.status === "running" ? "Discovery running…" : "Run discovery"}
              </Button>
              <Button onClick={runSearch} disabled={searchState !== "idle"} title="Social media and web search. Runs daily anyway; up to 3 manual runs a day.">
                <Search />
                {searchState === "starting" ? "Starting…" : searchState === "queued" ? "Search started" : "Search social & web"}
              </Button>
              <Button variant="primary" onClick={() => setReportOpen(true)}>
                <Plus />
                Add a suspicious link
              </Button>
            </>
          )
        }
      />

      {searchState === "queued" && (
        <Banner className="mb-4" tone="info">
          Search started. You&apos;ll get a notification with the result in a few minutes.
        </Banner>
      )}

      {run && (
        <Panel className="mb-4 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <span className="font-medium">{run.status === "running" ? "Discovery running" : run.status === "completed" ? "Discovery finished" : "Discovery failed"}</span>
            <span className="text-subtle tabular">
              {run.candidatesTotal > 0 ? `${run.candidatesChecked} / ${run.candidatesTotal} lookalike domains checked · ${run.findingsCreated} new` : "Preparing candidates…"}
            </span>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-raised">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500",
                run.status === "failed" ? "bg-sev-critical" : run.status === "completed" ? "bg-ok" : "bg-primary",
                run.candidatesTotal === 0 && run.status === "running" && "w-1/4 animate-pulse"
              )}
              style={run.candidatesTotal > 0 || run.status !== "running" ? { width: `${run.status === "running" ? runPct : 100}%` } : undefined}
            />
          </div>
          {run.error && <p className="mt-2 text-[13px] text-sev-critical">{run.error}</p>}
        </Panel>
      )}

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      <StatStrip label="Summary">
        <Stat label="Open threats" value={<Link href={`/threats?brandId=${summary.brand.id}`} className="hover:text-primary">{summary.openTotal}</Link>} note={`${summary.liveOpen} live right now`}>
          {summary.openTotal > 0 && (
            <div className="mb-2 mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded-sm" role="img" aria-label="Open threats by severity">
              {SEVERITIES.filter((s) => summary.openBySeverity[s]).map((s) => (
                <span key={s} className={SEV_BG[s]} style={{ flex: summary.openBySeverity[s] }} />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs">
            {SEVERITIES.map((s) => (
              <Link key={s} href={`/threats?severity=${s}&brandId=${summary.brand.id}`} className={cn("inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.04em] hover:underline", SEV_TEXT[s])}>
                <span className="size-2 rounded-[1px] bg-current" aria-hidden="true" />
                {s}
                <b className="font-mono font-medium text-foreground">{summary.openBySeverity[s] ?? 0}</b>
              </Link>
            ))}
          </div>
        </Stat>
        <Stat label="New this week" value={summary.newThisWeek} note={`${prevWeek} the week before`}>
          <Sparkline values={summary.newPerDay} label="New threats per day, last 14 days" />
        </Stat>
        <Stat label="Waiting on you" value={waiting} note="decisions">
          <div className="mt-2 text-xs text-muted-foreground">
            {queue.length} to triage
            {approvals > 0 && ` · ${approvals} to approve`}
            {manual > 0 && ` · ${manual} form${manual > 1 ? "s" : ""}`}
            {failed > 0 && ` · ${failed} failed`}
          </div>
        </Stat>
        <Stat label="Taken down" value={summary.takedownsDone.last30Days} note="last 30 days">
          <div className="mt-2 text-xs text-muted-foreground">
            {summary.takedownsDone.medianDays != null ? `Median ${summary.takedownsDone.medianDays} days to take down` : "None completed yet"}
          </div>
        </Stat>
      </StatStrip>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            <PanelHeader
              title="Needs a decision"
              count={queue.length}
              action={
                <Link href={`/threats?brandId=${summary.brand.id}`} className="text-primary hover:underline">
                  Open triage queue →
                </Link>
              }
            />
            {queue.length === 0 ? (
              <div className="flex flex-col items-center px-5 py-10 text-center">
                <span className="grid size-10 place-items-center rounded-full bg-ok/10 text-ok">
                  <CheckCircle2 className="size-5" />
                </span>
                <div className="mt-3 text-sm font-medium">Nothing high-risk is open</div>
                <div className="mt-1 text-xs text-subtle">New high and critical threats show up here. Discovery runs every 4 hours.</div>
              </div>
            ) : (
              <ul>
                {queue.map((f) => {
                  const t = describeTarget(f.identifier, f.type);
                  return (
                    <li key={f.id} className="grid grid-cols-[4px_minmax(0,1fr)] items-center gap-x-3 border-b border-border py-2.5 pr-3.5 last:border-b-0 sm:grid-cols-[4px_minmax(0,1fr)_auto]">
                      <span className={cn("self-stretch rounded-r-sm", SEV_BG[f.severity])} aria-hidden="true" />
                      <Link href={`/threats/${f.id}`} className="group flex min-w-0 flex-col gap-1">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <SeverityTag severity={f.severity} />
                          <Ident value={t.primary} highlight={f.type !== "social"} className="truncate group-hover:text-primary" />
                        </span>
                        {f.topReason && <span className="text-[12.5px] text-muted-foreground">{f.topReason}</span>}
                        <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-subtle">
                          {t.secondary && <span className="truncate">{t.secondary}</span>}
                          <span>{sourceLabel(f.source)}</span>
                          <span title={fullDate(f.firstDetectedAt)}>{timeAgo(f.firstDetectedAt)}</span>
                          <WebState state={f.webState} />
                          <span className="font-mono tabular">Score {f.riskScore}</span>
                        </span>
                      </Link>
                      {canAct && (
                        <div className="col-start-2 mt-2 flex gap-1.5 sm:col-start-auto sm:mt-0">
                          <Button size="sm" onClick={() => setStatus(f, "confirmed")}>
                            <Check />
                            Confirm
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setStatus(f, "false_positive")}>
                            <X />
                            Dismiss
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Activity"
              action={
                <Link href="/notifications" className="text-primary hover:underline">
                  All →
                </Link>
              }
            />
            {activity === null ? (
              <LoadingRegion label="Loading activity" className="space-y-3 p-3.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </LoadingRegion>
            ) : activity.length === 0 ? (
              <p className="p-3.5 text-xs text-subtle">No activity yet.</p>
            ) : (
              <ul>
                {activity.map((n) => {
                  const body = <span className={cn("line-clamp-2", n.readAt ? "text-muted-foreground" : "text-foreground")}>{n.message}</span>;
                  return (
                    <li key={n.id} className="grid grid-cols-[64px_1fr] gap-2.5 border-b border-border px-3.5 py-2.5 text-[12.5px] last:border-b-0">
                      <time className="pt-px font-mono text-[11.5px] text-subtle" title={fullDate(n.createdAt)}>
                        {timeAgo(n.createdAt)}
                      </time>
                      {n.findingId ? (
                        <Link href={`/threats/${n.findingId}`} className="hover:text-primary">
                          {body}
                        </Link>
                      ) : n.link ? (
                        <a href={n.link} target="_blank" rel="noreferrer" className="hover:text-primary">
                          {body}
                        </a>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            <PanelHeader
              title="Takedowns"
              count={`${summary.openTakedownCount} open`}
              action={
                <Link href="/takedowns" className="text-primary hover:underline">
                  All →
                </Link>
              }
            />
            {(approvals > 0 || manual > 0 || failed > 0) && (
              <Link href="/takedowns" className="flex items-center gap-2 border-b border-border px-3.5 py-2.5 text-[12.5px] text-sev-medium hover:bg-hover">
                <Clock className="size-4 shrink-0" />
                {[approvals && `${approvals} report${approvals > 1 ? "s" : ""} to approve`, manual && `${manual} form${manual > 1 ? "s" : ""} to fill in`, failed && `${failed} failed`]
                  .filter(Boolean)
                  .join(" · ")}
              </Link>
            )}
            {summary.openTakedowns.length === 0 ? (
              <p className="p-3.5 text-xs text-subtle">No open takedown requests. Start one from a threat&apos;s Takedown tab.</p>
            ) : (
              <ul>
                {summary.openTakedowns.map((t) => (
                  <li key={t.id} className="border-b border-border last:border-b-0">
                    <Link href={`/threats/${t.finding.id}?tab=takedown`} className="flex flex-col gap-1 px-3.5 py-2.5 hover:bg-hover">
                      <Ident value={describeTarget(t.finding.identifier, t.finding.type).primary} className="truncate text-[13px]" />
                      <span className="text-xs text-subtle">
                        {t.provider} · {t.status === "acknowledged" ? "acknowledged" : "requested"} {timeAgo(t.requestedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Detection sources" action={sourceEntries.length > 0 && <span className="text-subtle">{healthy} of {sourceEntries.length} healthy</span>} />
            {health === null ? (
              <LoadingRegion label="Loading source status" className="space-y-3 p-3.5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </LoadingRegion>
            ) : health === "unavailable" ? (
              <p className="p-3.5 text-xs text-subtle">Couldn&apos;t reach the server&apos;s status check.</p>
            ) : (
              <ul>
                {sourceEntries.map(([name, s]) => (
                  <li key={name} className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 border-b border-border px-3.5 py-2 text-[13px] last:border-b-0">
                    <span className={cn("size-[7px] rounded-full", s.stale ? "bg-sev-medium" : "bg-ok")} aria-hidden="true" />
                    <span className={s.stale ? "text-sev-medium" : undefined}>
                      {SOURCE_NAMES[name] ?? name}
                      {s.stale && ": not working"}
                    </span>
                    <span className="font-mono text-xs text-subtle" title={s.lastSuccessAt ? fullDate(s.lastSuccessAt) : undefined}>
                      {s.lastSuccessAt ? timeAgo(s.lastSuccessAt) : "waiting"}
                    </span>
                  </li>
                ))}
                {health.tavilyUsage && (
                  <li className="px-3.5 py-2 text-xs text-subtle">
                    Search credits: <span className="font-mono">{health.tavilyUsage.used}</span> of <span className="font-mono">{health.tavilyUsage.cap}</span> used this month
                  </li>
                )}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <AddLinkDialog open={reportOpen} onOpenChange={setReportOpen} brandId={summary.brand.id} />
    </div>
  );
}

function AddLinkDialog({ open, onOpenChange, brandId }: { open: boolean; onOpenChange: (o: boolean) => void; brandId: string }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/findings/manual-submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandId, url }) });
      setUrl("");
      onOpenChange(false);
      toast("Added. It's scanned and scored within a few minutes.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add a suspicious link" description="A website, a social media account or post, or an app listing. It's scanned and scored like any threat.">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Link" htmlFor="manual-url" error={error}>
            <Input id="manual-url" required type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} mono autoFocus />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Adding…" : "Add threat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FirstBrand({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const [form, setForm] = useState({ name: "", primaryDomain: "", concatKeywords: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<{ id: string }>("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          primaryDomain: form.primaryDomain,
          concatKeywords: form.concatKeywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        }),
      });
      await onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold">Protect your first brand</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">Enter the brand name and its primary domain to start monitoring.</p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
        <Field label="Brand name" htmlFor="fb-name">
          <Input id="fb-name" required placeholder="e.g. Jambojet" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Primary domain" htmlFor="fb-domain">
          <Input id="fb-domain" required mono placeholder="e.g. jambojet.com" value={form.primaryDomain} onChange={(e) => setForm({ ...form, primaryDomain: e.target.value })} />
        </Field>
        <Field label="Keywords (optional)" htmlFor="fb-kw" hint="Discovery combines these with the brand name to catch lookalikes like bookjambojet.com." error={error}>
          <Input id="fb-kw" placeholder="book, checkin, login" value={form.concatKeywords} onChange={(e) => setForm({ ...form, concatKeywords: e.target.value })} />
        </Field>
        <Button type="submit" variant="primary" disabled={busy} className="mt-1">
          {busy ? "Creating…" : "Create brand"}
        </Button>
      </form>
    </Panel>
  );
}
