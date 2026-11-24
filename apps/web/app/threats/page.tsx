import { serverApiFetch } from "../../lib/serverApi";
import { ThreatsTable } from "../../components/ThreatsTable";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/icons";
import { ThreatFilters } from "../../components/ThreatFilters";
import { PendingLink, PendingProvider, PendingSwap } from "../../components/PendingNavigation";
import { SkeletonTable } from "../../components/Skeleton";
import { statusLabel } from "../../lib/format";
import { PageHeader } from "../../components/ui/PageHeader";

export interface FindingRow {
  id: string;
  identifier: string;
  type: string;
  source: string;
  riskScore: number;
  severity: string;
  status: string;
  firstDetectedAt: string;
  lastScannedAt: string;
  assigneeId: string | null;
  tags: string[];
  brandName: string;
}

interface FindingsResponse {
  findings: FindingRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface Brand {
  id: string;
  name: string;
}

interface Member {
  userId: string;
  email: string;
}


// Next 15 passes searchParams as a Promise -- must be awaited before use.
type SearchParams = Promise<{
  status?: string;
  severity?: string;
  assigneeId?: string;
  brandId?: string;
  q?: string;
  sortBy?: string;
  sortDir?: string;
  page?: string;
}>;

export default async function ThreatsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  // No status in the URL is the default view, open findings only; "all" means no filter.
  const status = sp.status ?? "open";

  const qs = new URLSearchParams();
  if (sp.status) qs.set("status", sp.status);
  if (sp.severity) qs.set("severity", sp.severity);
  if (sp.assigneeId) qs.set("assigneeId", sp.assigneeId);
  if (sp.brandId) qs.set("brandId", sp.brandId);
  if (sp.q) qs.set("q", sp.q);
  if (sp.sortBy) qs.set("sortBy", sp.sortBy);
  if (sp.sortDir) qs.set("sortDir", sp.sortDir);
  if (sp.page) qs.set("page", sp.page);

  const apiQs = new URLSearchParams(qs);
  if (status === "all") apiQs.delete("status");
  else apiQs.set("status", status);

  const [data, brands, members] = await Promise.all([
    serverApiFetch<FindingsResponse>(`/api/findings?${apiQs.toString()}`),
    serverApiFetch<Brand[]>("/api/brands"),
    serverApiFetch<Member[]>("/api/organization/members"),
  ]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  // Preserves every other active filter/sort param when a link only changes one of them.
  // Any change but paging resets to page 1.
  function hrefWith(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams(qs);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in overrides)) next.delete("page");
    return `/threats?${next.toString()}`;
  }

  function sortHref(column: "riskScore" | "firstDetectedAt" | "lastScannedAt"): string {
    const nextDir = sp.sortBy === column && sp.sortDir === "asc" ? "desc" : "asc";
    return hrefWith({ sortBy: column, sortDir: nextDir });
  }

  // Every filter and the sort, but not the page: the export is all pages.
  const exportQs = new URLSearchParams(apiQs);
  exportQs.delete("page");

  const viewLabel = status === "open" ? "open" : status === "all" ? "" : statusLabel(status).toLowerCase();

  return (
    <PendingProvider>
      <PageHeader
        title="Threats"
        description={`${data.total} ${viewLabel} finding${data.total === 1 ? "" : "s"}: lookalike domains, scam pages, fake apps and accounts.`}
        actions={<ExportCsvButton query={exportQs.toString()} />}
      />

      <ThreatFilters brands={brands} members={members} />

      <div className="mt-4">
        <PendingSwap fallback={<SkeletonTable rows={Math.min(10, Math.max(4, data.findings.length))} />}>
          <ThreatsTable
            findings={data.findings}
            sortLinks={{ riskScore: sortHref("riskScore"), firstDetectedAt: sortHref("firstDetectedAt") }}
            currentSort={{ sortBy: sp.sortBy ?? "riskScore", sortDir: sp.sortDir ?? "desc" }}
            showBrand={brands.length > 1}
          />
        </PendingSwap>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <PendingLink href={hrefWith({ page: String(Math.max(1, data.page - 1)) })} disabled={data.page <= 1} className="btn-secondary px-3 py-1.5 text-xs">
            <ChevronLeftIcon className="h-3.5 w-3.5" /> Previous
          </PendingLink>
          <span className="text-ink-subtle">
            Page {data.page} of {totalPages}
          </span>
          <PendingLink href={hrefWith({ page: String(Math.min(totalPages, data.page + 1)) })} disabled={data.page >= totalPages} className="btn-secondary px-3 py-1.5 text-xs">
            Next <ChevronRightIcon className="h-3.5 w-3.5" />
          </PendingLink>
        </div>
      )}
    </PendingProvider>
  );
}
