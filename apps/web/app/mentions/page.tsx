"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useBrands } from "../../lib/brand";
import { apiFetch } from "../../lib/api";
import { cleanSnippet, fullDate, timeAgo } from "../../lib/format";
import { cn } from "../../lib/cn";
import { PageHeader } from "../../components/ui/PageHeader";
import { Stat, StatStrip } from "../../components/ui/StatStrip";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Field";
import { Banner } from "../../components/ui/Banner";
import { EmptyState } from "../../components/ui/EmptyState";
import { Pill } from "../../components/threat/atoms";
import { LoadingRegion, SkeletonList } from "../../components/Skeleton";

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

const PLATFORM_LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", x: "X", telegram: "Telegram", youtube: "YouTube" };
const PLATFORM_SHORT: Record<string, string> = { facebook: "FB", instagram: "IG", tiktok: "TT", x: "X", telegram: "TG", youtube: "YT" };
const SENTIMENT_DOT: Record<string, string> = { negative: "bg-sev-critical", neutral: "bg-sev-low", positive: "bg-ok" };
const SENTIMENT_TONE: Record<string, string> = { negative: "danger", neutral: "neutral", positive: "ok" };

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

const chip = "inline-flex h-8 items-center whitespace-nowrap rounded-md border px-2.5 text-[12.5px]";

// Posts that name the brand without impersonating it, from the daily social search
// (apps/api/src/pipeline/brandMentions.ts). A sample, not full social listening.
export default function MentionsPage() {
  const { selected } = useBrands();
  const brandId = selected?.id ?? null;
  const [filters, setFiltersState] = useState({ category: "", sentiment: "", platform: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MentionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A new filter or brand starts again from page 1.
  function setFilters(next: typeof filters) {
    setFiltersState(next);
    setPage(1);
  }

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
    setPage(1);
  }, [brandId]);

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    setError(null);
    apiFetch<MentionsResponse>(query())
      .then((next) => !cancelled && setData(next))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [brandId, query]);

  function goTo(p: number) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const summary = data?.summary;
  const topCategory = summary ? Object.entries(summary.byCategory).filter(([k]) => k !== "unlabelled").sort((a, b) => b[1] - a[1])[0] : undefined;

  return (
    <div>
      <PageHeader
        title="Mentions"
        description={`What people say about ${selected?.name ?? "your brand"} on social media. For reading, not triage: impersonation and scams go to Threats on their own.`}
      />

      {summary && (
        <StatStrip label="Mentions summary">
          <Stat label={`Last ${summary.days} days`} value={summary.total} note="mentions">
            {summary.total > 0 && (
              <div className="mb-2 mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded-sm" role="img" aria-label="Mentions by sentiment">
                {SENTIMENTS.filter((s) => summary.bySentiment[s]).map((s) => (
                  <span key={s} className={SENTIMENT_DOT[s]} style={{ flex: summary.bySentiment[s] }} />
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
              {SENTIMENTS.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-[1px]", SENTIMENT_DOT[s])} aria-hidden="true" />
                  {cap(s)} <b className="font-mono font-medium text-foreground">{summary.bySentiment[s] ?? 0}</b>
                </span>
              ))}
            </div>
          </Stat>
          <Stat label="Complaints" value={summary.byCategory.complaint ?? 0} tone={(summary.byCategory.complaint ?? 0) > 0 ? "text-sev-medium" : undefined} />
          <Stat label="Most common" value={topCategory ? cap(topCategory[0]) : "–"} note={topCategory ? `${topCategory[1]} of ${summary.total}` : undefined} />
          <Stat label="Unlabelled" value={summary.byCategory.unlabelled ?? 0} note="not classified yet" />
        </StatStrip>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platform">
          <button type="button" aria-pressed={!filters.platform} onClick={() => setFilters({ ...filters, platform: "" })} className={cn(chip, !filters.platform ? "border-primary/50 bg-primary-soft text-foreground" : "border-dashed border-border-strong text-muted-foreground hover:border-solid")}>
            All platforms
          </button>
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={filters.platform === p}
              onClick={() => setFilters({ ...filters, platform: filters.platform === p ? "" : p })}
              className={cn(chip, filters.platform === p ? "border-primary/50 bg-primary-soft text-foreground" : "border-dashed border-border-strong text-muted-foreground hover:border-solid hover:text-foreground")}
            >
              {PLATFORM_LABEL[p]}
            </button>
          ))}
        </div>
        <Select aria-label="Category" className="h-8 w-auto" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {cap(c)}
            </option>
          ))}
        </Select>
        <Select aria-label="Sentiment" className="h-8 w-auto" value={filters.sentiment} onChange={(e) => setFilters({ ...filters, sentiment: e.target.value })}>
          <option value="">All sentiment</option>
          {SENTIMENTS.map((s) => (
            <option key={s} value={s}>
              {cap(s)}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      {!data ? (
        <LoadingRegion label="Loading mentions">
          <SkeletonList rows={5} />
        </LoadingRegion>
      ) : data.mentions.length === 0 ? (
        <EmptyState title="No mentions here">
          {filters.category || filters.sentiment || filters.platform ? "Nothing matches these filters." : "The daily social search adds posts that name the brand as it finds them."}
        </EmptyState>
      ) : (
        <ul className="rounded-md border border-border bg-card">
          {data.mentions.map((m) => {
            const text = cleanSnippet(m.snippet, m.title);
            return (
              <li key={m.id} className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-3 border-b border-border px-3.5 py-3 text-[13px] last:border-b-0">
                <span className="grid size-8 place-items-center rounded-md border border-border bg-raised text-[11px] font-bold text-muted-foreground" aria-hidden="true">
                  {PLATFORM_SHORT[m.platform] ?? m.platform.slice(0, 2).toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="text-[12.5px] text-subtle">
                    {m.handle && <b className="font-medium text-foreground">@{m.handle}</b>}
                    {m.handle && " · "}
                    {PLATFORM_LABEL[m.platform] ?? m.platform} · <span title={fullDate(m.firstSeenAt)}>{timeAgo(m.firstSeenAt)}</span>
                  </div>
                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-start gap-1 font-medium hover:text-primary">
                    <span className="min-w-0 [overflow-wrap:anywhere]">{m.title ?? m.url}</span>
                    <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-subtle group-hover:text-primary" aria-hidden="true" />
                  </a>
                  {text && <p className="line-clamp-3 text-muted-foreground">{text}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={m.category === "complaint" ? "warn" : "neutral"}>{m.category ? cap(m.category) : "Unlabelled"}</Pill>
                    {m.sentiment && <Pill tone={SENTIMENT_TONE[m.sentiment]}>{cap(m.sentiment)}</Pill>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.totalPages > 1 && (
        <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-[13px]">
          <Button size="sm" disabled={data.page <= 1} onClick={() => goTo(data.page - 1)}>
            <ChevronLeft />
            Previous
          </Button>
          <span className="text-subtle tabular">
            Page {data.page} of {data.totalPages} · {data.total} mentions
          </span>
          <Button size="sm" disabled={data.page >= data.totalPages} onClick={() => goTo(data.page + 1)}>
            Next
            <ChevronRight />
          </Button>
        </nav>
      )}
    </div>
  );
}
