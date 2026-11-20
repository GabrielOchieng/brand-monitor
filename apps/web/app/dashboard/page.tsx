"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { apiFetch, API_URL } from "../../lib/api";
import { RadarIcon, SearchIcon, FlagIcon, ChevronDownIcon, ChevronRightIcon, CheckIcon } from "../../components/icons";
import { SeverityBadge } from "../../components/SeverityBadge";
import { TargetIcon } from "../../components/ThreatsTable";
import { DashboardSkeleton } from "../../components/PageSkeletons";
import { LoadingRegion, Skeleton } from "../../components/Skeleton";
import { describeTarget, fullDate, sourceLabel, statusLabel, STATUS_PILL, timeAgo } from "../../lib/format";
import { pickBrand, writeSelectedBrand } from "../../lib/selectedBrand";

interface AttentionItem {
  id: string;
  identifier: string;
  type: string;
  source: string;
  severity: string;
  riskScore: number;
  status: string;
  firstDetectedAt: string;
}

interface Summary {
  brand: { id: string; name: string; primaryDomain: string; hasVisualBaseline: boolean };
  openBySeverity: Record<string, number>;
  openTotal: number;
  newThisWeek: number;
  attention: AttentionItem[];
  openTakedowns: Array<{ id: string; provider: string; status: string; requestedAt: string; finding: { id: string; identifier: string; type: string } }>;
  openTakedownCount: number;
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
const SEVERITY_EDGE: Record<string, string> = {
  critical: "border-l-critical",
  high: "border-l-high",
  medium: "border-l-medium",
  low: "border-l-low",
};

const SOURCE_NAMES: Record<string, string> = {
  ct_log: "Certificate logs",
  nrd: "New-domain feed",
  phish_feed: "Phishing feed",
  google_play: "Google Play",
  social_search: "Social and web search",
};

export default function DashboardPage() {
  const { getToken, orgId, isLoaded } = useAuth();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [health, setHealth] = useState<Health | null | "unavailable">(null);
  const [activity, setActivity] = useState<NotificationItem[] | null>(null);
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "starting" | "queued">("idle");
  const [showReport, setShowReport] = useState(false);
  const [submitUrl, setSubmitUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", primaryDomain: "", concatKeywords: "" });

  const loadSummary = useCallback(
    async (id: string) => {
      try {
        const data = await apiFetch<Summary>(`/api/dashboard/summary?brandId=${encodeURIComponent(id)}`, await getToken());
        setSummary(data);
      } catch (err: any) {
        setError(err.message);
      }
    },
    [getToken]
  );

  // Brands first; the summary follows for the remembered (or first) brand.
  useEffect(() => {
    if (!isLoaded || !orgId) return;
    (async () => {
      try {
        const list = await apiFetch<Brand[]>("/api/brands", await getToken());
        setBrands(list);
        const chosen = pickBrand(list);
        if (chosen) setBrandId(chosen.id);
      } catch (err: any) {
        setError(err.message);
        setBrands([]);
      }
    })();
  }, [isLoaded, orgId, getToken]);

  useEffect(() => {
    if (!brandId) return;
    setSummary(null);
    setRun(null);
    setSearchState("idle");
    loadSummary(brandId);
  }, [brandId, loadSummary]);

  // Org-wide, so loaded once: detection-source health (public endpoint) and recent activity.
  useEffect(() => {
    if (!isLoaded || !orgId) return;
    fetch(`${API_URL}/health/jobs`, { cache: "no-store" })
      .then((r) => r.json())
      .then((h) => setHealth(h))
      .catch(() => setHealth("unavailable"));
    (async () => {
      try {
        const data = await apiFetch<{ notifications: NotificationItem[] }>("/api/notifications", await getToken());
        setActivity(data.notifications.slice(0, 6));
      } catch {
        setActivity([]);
      }
    })();
  }, [isLoaded, orgId, getToken]);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    const interval = setInterval(async () => {
      try {
        const updated = await apiFetch<RunStatus>(`/api/pipeline/runs/${run.id}`, await getToken());
        setRun(updated);
        if (updated.status !== "running") {
          clearInterval(interval);
          if (brandId) loadSummary(brandId);
        }
      } catch {
        // transient -- the next tick retries
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [run, brandId, loadSummary, getToken]);

  function selectBrand(id: string) {
    writeSelectedBrand(id);
    setBrandId(id);
  }

  async function runDiscovery() {
    if (!brandId) return;
    setError(null);
    try {
      const { runId } = await apiFetch<{ runId: string }>("/api/pipeline/run", await getToken(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      setRun({ id: runId, status: "running", candidatesTotal: 0, candidatesChecked: 0, findingsCreated: 0, error: null });
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function runSearch() {
    if (!brandId) return;
    setError(null);
    setSearchState("starting");
    try {
      await apiFetch("/api/pipeline/social-search", await getToken(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      setSearchState("queued");
    } catch (err: any) {
      setError(err.message);
      setSearchState("idle");
    }
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (!brandId) return;
    setSubmitting(true);
    setSubmitMessage(null);
    setError(null);
    try {
      await apiFetch("/api/findings/manual-submit", await getToken(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, url: submitUrl }),
      });
      setSubmitUrl("");
      setSubmitMessage("Added. It's scanned and scored within a few minutes.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function createFirstBrand(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await apiFetch<Brand>("/api/brands", await getToken(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          primaryDomain: form.primaryDomain,
          concatKeywords: form.concatKeywords.split(",").map((k) => k.trim()).filter(Boolean),
        }),
      });
      setBrands([created]);
      selectBrand(created.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  if (!isLoaded) return <DashboardSkeleton />;

  if (!orgId) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold text-ink">Select or create an organization</h1>
        <p className="mt-2 text-sm text-ink-muted">Use the organization switcher in the top bar to continue.</p>
      </div>
    );
  }

  if (brands && brands.length === 0) {
    return (
      <div className="card mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold text-ink">Protect your first brand</h1>
        <p className="mt-1 text-sm text-ink-muted">Enter the brand name and its primary domain to start monitoring.</p>
        <form onSubmit={createFirstBrand} className="mt-6 space-y-3">
          <input required placeholder="Brand name (e.g. Jambojet)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="field w-full" />
          <input required placeholder="Primary domain (e.g. jambojet.com)" value={form.primaryDomain} onChange={(e) => setForm({ ...form, primaryDomain: e.target.value })} className="field w-full" />
          <input placeholder="Keywords, comma-separated (e.g. book, checkin, login)" value={form.concatKeywords} onChange={(e) => setForm({ ...form, concatKeywords: e.target.value })} className="field w-full" />
          <p className="text-xs text-ink-subtle">Optional, but recommended: discovery combines these with the brand name to catch lookalikes like bookjambojet.com.</p>
          <button type="submit" disabled={creating} className="btn-primary w-full">
            {creating ? "Creating…" : "Create brand"}
          </button>
        </form>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (!summary) {
    return error ? <p className="text-sm text-red-600">{error}</p> : <DashboardSkeleton />;
  }

  const runPct = run && run.candidatesTotal > 0 ? Math.round((run.candidatesChecked / run.candidatesTotal) * 100) : 0;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Overview</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-ink-subtle">
            {brands && brands.length > 1 ? (
              <div className="relative">
                <select value={brandId ?? ""} onChange={(e) => selectBrand(e.target.value)} className="field-sm appearance-none py-1 pr-7 font-medium text-ink" aria-label="Brand">
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
              </div>
            ) : (
              <span className="font-medium text-ink-muted">{summary.brand.name}</span>
            )}
            <span>·</span>
            <span>{summary.brand.primaryDomain}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={runDiscovery} disabled={run?.status === "running"} className="btn-secondary">
            <RadarIcon className="h-4 w-4" /> {run?.status === "running" ? "Discovery running…" : "Run discovery"}
          </button>
          <button onClick={runSearch} disabled={searchState !== "idle"} className="btn-secondary" title="Social media and web search. Runs daily anyway; up to 3 manual runs a day.">
            <SearchIcon className="h-4 w-4" /> {searchState === "starting" ? "Starting…" : searchState === "queued" ? "Search started" : "Search social & web"}
          </button>
          <button onClick={() => setShowReport((v) => !v)} className="btn-primary">
            <FlagIcon className="h-4 w-4" /> Add a suspicious link
          </button>
        </div>
      </div>

      {showReport && (
        <form onSubmit={submitManual} className="card mt-4 p-4">
          <label className="label" htmlFor="manual-url">
            Suspicious link
          </label>
          <p className="mt-0.5 text-xs text-ink-subtle">A website, a social media account or post, or an app listing. It&apos;s scanned and scored like any finding.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input id="manual-url" required type="url" placeholder="https://…" value={submitUrl} onChange={(e) => setSubmitUrl(e.target.value)} className="field flex-1" autoFocus />
            <button type="submit" disabled={submitting} className="btn-primary shrink-0">
              {submitting ? "Adding…" : "Add finding"}
            </button>
          </div>
          {submitMessage && <p className="mt-2 text-xs text-emerald-700">{submitMessage}</p>}
        </form>
      )}

      {searchState === "queued" && (
        <p className="mt-4 rounded-md border border-brand/20 bg-brand/5 px-4 py-2.5 text-sm text-ink-muted">
          Search started. You&apos;ll get a notification with the result in a few minutes.
        </p>
      )}

      {run && (
        <div className="card mt-4 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink">
              {run.status === "running" ? "Discovery running" : run.status === "completed" ? "Discovery finished" : "Discovery failed"}
            </span>
            <span className="text-ink-subtle">
              {run.candidatesTotal > 0 ? `${run.candidatesChecked} / ${run.candidatesTotal} lookalike domains checked · ${run.findingsCreated} new` : "Preparing candidates…"}
            </span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${run.status === "failed" ? "bg-red-500" : run.status === "completed" ? "bg-emerald-500" : "bg-brand"} ${run.candidatesTotal === 0 && run.status === "running" ? "w-1/4 animate-pulse" : ""}`}
              style={run.candidatesTotal > 0 || run.status !== "running" ? { width: `${run.status === "running" ? runPct : 100}%` } : undefined}
            />
          </div>
          {run.error && <p className="mt-2 text-sm text-red-600">{run.error}</p>}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {/* Open threats */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Link href="/threats" className="card col-span-2 flex flex-col justify-between p-5 transition-shadow hover:shadow-md">
          <div className="label">Open threats</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-4xl font-semibold tabular-nums text-ink">{summary.openTotal}</span>
            <span className="text-sm text-ink-subtle">{summary.newThisWeek} new this week</span>
          </div>
        </Link>
        {SEVERITIES.map((sev) => (
          <Link
            key={sev}
            href={`/threats?severity=${sev}&brandId=${summary.brand.id}`}
            className={`card block border-l-[3px] p-4 transition-shadow hover:shadow-md ${SEVERITY_EDGE[sev]}`}
          >
            <div className="label">{sev}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{summary.openBySeverity[sev] ?? 0}</div>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Needs attention */}
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">Needs attention</h2>
              <p className="text-xs text-ink-subtle">Open high and critical findings, newest untriaged first</p>
            </div>
            <Link href={`/threats?brandId=${summary.brand.id}`} className="btn-ghost text-xs">
              All threats <ChevronRightIcon className="h-3.5 w-3.5" />
            </Link>
          </div>
          {summary.attention.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckIcon className="h-5 w-5" />
              </span>
              <div className="mt-3 text-sm font-medium text-ink">Nothing high-risk is open</div>
              <div className="mt-1 text-xs text-ink-subtle">New high and critical findings will show up here. Discovery runs every 4 hours.</div>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {summary.attention.map((f) => {
                const t = describeTarget(f.identifier, f.type);
                return (
                  <li key={f.id}>
                    <Link href={`/threats/${f.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-elevated/50">
                      <TargetIcon type={f.type} platform={t.platform} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{t.primary}</div>
                        <div className="truncate text-xs text-ink-subtle">
                          {[t.secondary, sourceLabel(f.source)].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <span className={`hidden rounded-full border px-2 py-0.5 text-xs font-medium sm:inline ${STATUS_PILL[f.status] ?? STATUS_PILL.new}`}>{statusLabel(f.status)}</span>
                      <SeverityBadge severity={f.severity} />
                      <span className="hidden w-14 text-right text-xs text-ink-subtle sm:block" title={fullDate(f.firstDetectedAt)}>
                        {timeAgo(f.firstDetectedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {/* Takedowns */}
          <section className="card">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-sm font-semibold text-ink">Takedowns in progress</h2>
              <span className="text-xs tabular-nums text-ink-subtle">{summary.openTakedownCount}</span>
            </div>
            {summary.openTakedowns.length === 0 ? (
              <p className="px-5 py-6 text-xs text-ink-subtle">No open takedown requests. Request one from a finding&apos;s page.</p>
            ) : (
              <ul className="divide-y divide-line">
                {summary.openTakedowns.map((t) => (
                  <li key={t.id}>
                    <Link href={`/threats/${t.finding.id}`} className="block px-5 py-3 hover:bg-elevated/50">
                      <div className="truncate text-sm font-medium text-ink">{describeTarget(t.finding.identifier, t.finding.type).primary}</div>
                      <div className="text-xs text-ink-subtle">
                        {t.provider} · {t.status === "acknowledged" ? "acknowledged" : "requested"} {timeAgo(t.requestedAt)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Detection sources */}
          <section className="card">
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-sm font-semibold text-ink">Detection sources</h2>
            </div>
            {health === null ? (
              <LoadingRegion label="Loading source status" className="space-y-3 px-5 py-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </LoadingRegion>
            ) : health === "unavailable" ? (
              <p className="px-5 py-4 text-xs text-ink-subtle">Couldn&apos;t reach the server&apos;s status check.</p>
            ) : (
              <ul className="space-y-2.5 px-5 py-4 text-sm">
                {Object.entries(health.sources).map(([name, s]) => (
                  <li key={name} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-ink-muted">
                      <span className={`h-2 w-2 rounded-full ${s.stale ? "bg-amber-500" : "bg-emerald-500"}`} />
                      {SOURCE_NAMES[name] ?? name}
                    </span>
                    <span className={`text-xs ${s.stale ? "text-amber-700" : "text-ink-subtle"}`} title={s.lastSuccessAt ? fullDate(s.lastSuccessAt) : undefined}>
                      {s.lastSuccessAt ? timeAgo(s.lastSuccessAt) : s.stale ? "not working" : "waiting"}
                    </span>
                  </li>
                ))}
                {health.tavilyUsage && (
                  <li className="pt-1 text-xs text-ink-subtle">
                    Search credits: {health.tavilyUsage.used} of {health.tavilyUsage.cap} used this month
                  </li>
                )}
              </ul>
            )}
          </section>

          {/* Recent activity */}
          <section className="card">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
              <Link href="/notifications" className="btn-ghost text-xs">
                All <ChevronRightIcon className="h-3.5 w-3.5" />
              </Link>
            </div>
            {activity === null ? (
              <LoadingRegion label="Loading activity" className="space-y-3 px-5 py-4">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </LoadingRegion>
            ) : activity.length === 0 ? (
              <p className="px-5 py-6 text-xs text-ink-subtle">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {activity.map((n) => {
                  const href = n.findingId ? `/threats/${n.findingId}` : n.link;
                  const body = (
                    <>
                      <div className={`line-clamp-2 text-sm ${n.readAt ? "text-ink-subtle" : "text-ink"}`}>{n.message}</div>
                      <div className="mt-0.5 text-xs text-ink-faint">{timeAgo(n.createdAt)}</div>
                    </>
                  );
                  return (
                    <li key={n.id}>
                      {href ? (
                        <a href={href} target={n.findingId ? undefined : "_blank"} rel="noreferrer" className="block px-5 py-3 hover:bg-elevated/50">
                          {body}
                        </a>
                      ) : (
                        <div className="px-5 py-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

    </div>
  );
}
