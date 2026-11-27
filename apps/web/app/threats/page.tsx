import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { serverApiFetch } from "../../lib/serverApi";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { PageHeader } from "../../components/ui/PageHeader";
import { LinkTabs } from "../../components/ui/Tabs";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { ThreatQueue } from "../../components/threat/ThreatQueue";
import { ThreatToolbar } from "../../components/threat/ThreatToolbar";
import type { FindingsResponse, Member } from "../../components/threat/types";

// Next 15 passes searchParams as a Promise -- must be awaited before use.
type SearchParams = Promise<Record<string, string | undefined>>;

const PASS_THROUGH = ["severity", "assigneeId", "brandId", "type", "q", "sortBy", "sortDir", "page"] as const;

// Saved views, in the order an analyst works: what needs a decision, then the rest.
const VIEWS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "open", label: "Needs action", statuses: ["new", "investigating", "confirmed"] },
  { key: "new", label: "New", statuses: ["new"] },
  { key: "investigating", label: "Investigating", statuses: ["investigating"] },
  { key: "confirmed", label: "Confirmed", statuses: ["confirmed"] },
  { key: "resolved", label: "Resolved", statuses: ["resolved"] },
  { key: "false_positive", label: "Dismissed", statuses: ["false_positive"] },
  { key: "all", label: "All", statuses: [] },
];

export default async function ThreatsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // No status in the URL is the default view, open threats only; "all" means no filter.
  const view = VIEWS.some((v) => v.key === sp.status) ? sp.status! : "open";

  const qs = new URLSearchParams();
  for (const k of PASS_THROUGH) if (sp[k]) qs.set(k, sp[k]!);
  if (sp.status) qs.set("status", sp.status);
  const apiQs = new URLSearchParams(qs);
  if (view === "all") apiQs.delete("status");
  else apiQs.set("status", view);

  const [data, brands, members] = await Promise.all([
    serverApiFetch<FindingsResponse>(`/api/findings?${apiQs.toString()}`),
    serverApiFetch<Array<{ id: string; name: string }>>("/api/brands"),
    serverApiFetch<Member[]>("/api/organization/members"),
  ]);

  // Preserves every other filter and the sort; any change but paging goes back to page 1.
  function hrefWith(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams(qs);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in overrides)) next.delete("page");
    const s = next.toString();
    return s ? `/threats?${s}` : "/threats";
  }
  const sortBy = sp.sortBy ?? "riskScore";
  const sortDir = sp.sortDir ?? "desc";
  const sortHref = (k: "riskScore" | "firstDetectedAt"): string => hrefWith({ sortBy: k, sortDir: sortBy === k && sortDir === "desc" ? "asc" : "desc" });

  const count = (statuses: string[]): number =>
    statuses.length === 0 ? Object.values(data.statusCounts).reduce((a, b) => a + b, 0) : statuses.reduce((a, s) => a + (data.statusCounts[s] ?? 0), 0);
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const exportQs = new URLSearchParams(apiQs);
  exportQs.delete("page");

  return (
    <div>
      <PageHeader
        title="Threats"
        description="Every lookalike domain, scam page, fake app and account found for your brands, highest risk first."
        actions={<ExportCsvButton query={exportQs.toString()} />}
      />
      <LinkTabs
        label="Views"
        className="mb-3"
        items={VIEWS.map((v) => ({ href: hrefWith({ status: v.key === "open" ? undefined : v.key }), label: v.label, count: v.key === "open" ? data.openCount : count(v.statuses), active: v.key === view }))}
      />
      <ThreatToolbar brands={brands} members={members} />

      {data.findings.length === 0 ? (
        <EmptyState title={sp.q || sp.severity || sp.type || sp.assigneeId || sp.brandId ? "Nothing matches these filters" : "Nothing in this view"}>
          {view === "open" ? "No threat needs action right now. New ones appear here as discovery and the feeds find them." : "Try another view or clear the filters."}
        </EmptyState>
      ) : (
        <ThreatQueue findings={data.findings} members={members} showBrand={brands.length > 1} sort={{ sortBy, sortDir }} sortHrefs={{ riskScore: sortHref("riskScore"), firstDetectedAt: sortHref("firstDetectedAt") }} />
      )}

      {totalPages > 1 && (
        <nav aria-label="Pages" className="mt-3 flex items-center justify-between text-[13px]">
          {data.page > 1 ? (
            <Button size="sm" asChild>
              <Link href={hrefWith({ page: String(data.page - 1) })}>
                <ChevronLeft />
                Previous
              </Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-subtle tabular">
            Page {data.page} of {totalPages} · {data.total} threats
          </span>
          {data.page < totalPages ? (
            <Button size="sm" asChild>
              <Link href={hrefWith({ page: String(data.page + 1) })}>
                Next
                <ChevronRight />
              </Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
