"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../../lib/api";
import { ExternalLinkIcon } from "../../components/icons";
import { LoadingRegion, Skeleton, SkeletonList } from "../../components/Skeleton";
import { cleanSnippet, fullDate, timeAgo } from "../../lib/format";

interface Brand {
  id: string;
  name: string;
}

interface Mention {
  id: string;
  url: string;
  platform: string;
  handle: string | null;
  title: string | null;
  snippet: string | null;
  category: string | null;
  sentiment: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface MentionsResponse {
  mentions: Mention[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: { days: number; total: number; byCategory: Record<string, number>; bySentiment: Record<string, number> };
}

const CATEGORIES = ["news", "complaint", "promotion", "general", "unlabelled"] as const;
const SENTIMENTS = ["negative", "neutral", "positive"] as const;
const PLATFORMS = ["facebook", "instagram", "tiktok", "x", "telegram", "youtube"] as const;

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  telegram: "Telegram",
  youtube: "YouTube",
};

const SENTIMENT_CLASS: Record<string, string> = {
  negative: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-line bg-surface text-ink-muted",
  positive: "border-green-200 bg-green-50 text-green-700",
};

function capitalize(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}

// Non-threat social posts that name the brand, collected by the daily social search
// (apps/api/src/pipeline/brandMentions.ts). A sample, not full social listening.
export default function MentionsPage() {
  const { getToken, isLoaded, orgId } = useAuth();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [filters, setFiltersState] = useState({ category: "", sentiment: "", platform: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MentionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new filter or brand starts again from page 1.
  function setFilters(next: typeof filters) {
    setFiltersState(next);
    setPage(1);
  }

  useEffect(() => {
    if (!isLoaded || !orgId) return;
    (async () => {
      try {
        const list = await apiFetch<Brand[]>("/api/brands", await getToken());
        setBrands(list);
        setBrandId((current) => current ?? list[0]?.id ?? null);
      } catch (err: any) {
        setError(err.message);
      }
    })();
  }, [isLoaded, orgId, getToken]);

  const query = useCallback(() => {
    const qs = new URLSearchParams();
    if (filters.category) qs.set("category", filters.category);
    if (filters.sentiment) qs.set("sentiment", filters.sentiment);
    if (filters.platform) qs.set("platform", filters.platform);
    if (page > 1) qs.set("page", String(page));
    const s = qs.toString();
    return `/api/brands/${brandId}/mentions${s ? `?${s}` : ""}`;
  }, [brandId, filters, page]);

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    (async () => {
      setError(null);
      setLoading(true);
      try {
        const next = await apiFetch<MentionsResponse>(query(), await getToken());
        if (!cancelled) setData(next);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId, query, getToken]);

  function goTo(p: number) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const summary = data?.summary;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Mentions</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Social media posts that mention the brand but aren&apos;t threats: news, complaints, promotions and general chatter.
            Collected by the daily social search from posts search engines have indexed in the past month, so this is a
            sample, not full social listening. Labels are AI-generated.
          </p>
        </div>
        {brands.length > 1 && (
          <select
            value={brandId ?? ""}
            onChange={(e) => {
              setBrandId(e.target.value);
              setPage(1);
            }}
            className="field-sm"
            aria-label="Brand"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {!summary && !error && (
        <LoadingRegion label="Loading summary" className="card mt-6 flex flex-wrap gap-10 p-5">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-12" />
          </div>
          {[3, 5].map((n, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <div className="flex gap-2">
                {Array.from({ length: n }, (_, j) => (
                  <Skeleton key={j} className="h-6 w-20" />
                ))}
              </div>
            </div>
          ))}
        </LoadingRegion>
      )}

      {summary && (
        <section className="card mt-6 grid gap-4 p-5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="label">Last {summary.days} days</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{summary.total}</div>
            <div className="text-xs text-ink-subtle">new mentions</div>
          </div>
          <div>
            <div className="label">Sentiment</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {SENTIMENTS.map((s) => (
                <span key={s} className={`rounded-md border px-2 py-0.5 text-xs tabular-nums ${SENTIMENT_CLASS[s]}`}>
                  {capitalize(s)} {summary.bySentiment[s] ?? 0}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="label">Category</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORIES.filter((c) => c !== "unlabelled" || summary.byCategory.unlabelled).map((c) => (
                <span key={c} className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs tabular-nums text-ink-muted">
                  {capitalize(c)} {summary.byCategory[c] ?? 0}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="field-sm" aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {capitalize(c)}
            </option>
          ))}
        </select>
        <select value={filters.sentiment} onChange={(e) => setFilters({ ...filters, sentiment: e.target.value })} className="field-sm" aria-label="Sentiment">
          <option value="">All sentiment</option>
          {SENTIMENTS.map((s) => (
            <option key={s} value={s}>
              {capitalize(s)}
            </option>
          ))}
        </select>
        <select value={filters.platform} onChange={(e) => setFilters({ ...filters, platform: e.target.value })} className="field-sm" aria-label="Platform">
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {(loading || !data) && !error && (
        <LoadingRegion label="Loading mentions" className="mt-3">
          <SkeletonList rows={5} lines={2} />
        </LoadingRegion>
      )}

      {data && !loading && (
        <div className="card mt-3 divide-y divide-line">
          {data.mentions.map((m) => (
            <article key={m.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                <span className="font-medium text-ink">{PLATFORM_LABEL[m.platform] ?? m.platform}</span>
                {m.handle && <span className="font-mono">@{m.handle}</span>}
                <span title={fullDate(m.firstSeenAt)}>· found {timeAgo(m.firstSeenAt)}</span>
                <span className="ml-auto flex gap-1.5">
                  {m.category ? (
                    <span className="rounded border border-line px-1.5 py-0.5">{capitalize(m.category)}</span>
                  ) : (
                    <span className="rounded border border-dashed border-line px-1.5 py-0.5">Unlabelled</span>
                  )}
                  {m.sentiment && <span className={`rounded border px-1.5 py-0.5 ${SENTIMENT_CLASS[m.sentiment]}`}>{capitalize(m.sentiment)}</span>}
                </span>
              </div>
              <a href={m.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-start gap-1 font-medium text-ink hover:text-brand-hover">
                <span className="min-w-0 break-words">{m.title ?? m.url}</span>
                <ExternalLinkIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              </a>
              {cleanSnippet(m.snippet, m.title) && <p className="mt-1 line-clamp-3 text-ink-muted">{cleanSnippet(m.snippet, m.title)}</p>}
            </article>
          ))}
          {data.mentions.length === 0 && (
            <p className="px-4 py-6 text-sm text-ink-subtle">
              No mentions yet. They&apos;re collected by the daily social search (or &quot;Search now&quot; on the dashboard).
            </p>
          )}
        </div>
      )}

      {data && data.total > 0 && (
        <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Pages">
          <span className="text-ink-subtle tabular-nums">
            {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          {data.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => goTo(page - 1)} disabled={loading || page <= 1} className="btn-secondary">
                Previous
              </button>
              <span className="tabular-nums text-ink-muted">
                Page {data.page} of {data.totalPages}
              </span>
              <button onClick={() => goTo(page + 1)} disabled={loading || page >= data.totalPages} className="btn-secondary">
                Next
              </button>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
