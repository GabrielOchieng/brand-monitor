import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { apiFetch } from "../../lib/api";
import { ThreatsTable } from "../../components/ThreatsTable";
import { SearchIcon, ChevronLeftIcon, ChevronRightIcon } from "../../components/icons";

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

const STATUSES = ["new", "investigating", "confirmed", "false_positive", "resolved"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;

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
  const { getToken } = await auth();
  const token = await getToken();

  const qs = new URLSearchParams();
  if (sp.status) qs.set("status", sp.status);
  if (sp.severity) qs.set("severity", sp.severity);
  if (sp.assigneeId) qs.set("assigneeId", sp.assigneeId);
  if (sp.brandId) qs.set("brandId", sp.brandId);
  if (sp.q) qs.set("q", sp.q);
  if (sp.sortBy) qs.set("sortBy", sp.sortBy);
  if (sp.sortDir) qs.set("sortDir", sp.sortDir);
  if (sp.page) qs.set("page", sp.page);

  const [data, brands, members] = await Promise.all([
    apiFetch<FindingsResponse>(`/api/findings?${qs.toString()}`, token),
    apiFetch<Brand[]>("/api/brands", token),
    apiFetch<Member[]>("/api/organization/members", token),
  ]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  // Preserves every other active filter/sort param when a link only changes one of
  // them (e.g. clicking a column header to sort shouldn't drop the status filter).
  function hrefWith(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams(qs);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    // Any filter/sort change resets to page 1 -- a stale page number from a much
    // larger unfiltered result set could otherwise land past the end of a new,
    // smaller filtered result set.
    if (!("page" in overrides)) next.delete("page");
    return `/threats?${next.toString()}`;
  }

  function sortHref(column: "riskScore" | "firstDetectedAt" | "lastScannedAt"): string {
    const nextDir = sp.sortBy === column && sp.sortDir === "asc" ? "desc" : "asc";
    return hrefWith({ sortBy: column, sortDir: nextDir });
  }

  const hasActiveFilters = Boolean(sp.status || sp.severity || sp.brandId || sp.q || sp.assigneeId);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Threat feed</h1>
        <p className="text-sm text-ink-subtle">
          {data.total} finding{data.total === 1 ? "" : "s"} · page {data.page} of {totalPages}
        </p>
      </div>

      <form method="GET" className="card mt-4 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">Status</label>
          <select name="status" defaultValue={sp.status ?? ""} className="field-sm mt-1">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Severity</label>
          <select name="severity" defaultValue={sp.severity ?? ""} className="field-sm mt-1">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {brands.length > 1 && (
          <div>
            <label className="label">Brand</label>
            <select name="brandId" defaultValue={sp.brandId ?? ""} className="field-sm mt-1">
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Assignee</label>
          <select name="assigneeId" defaultValue={sp.assigneeId ?? ""} className="field-sm mt-1">
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[160px] flex-1">
          <label className="label">Search</label>
          <div className="relative mt-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Domain contains…" className="field-sm w-full pl-8" />
          </div>
        </div>
        <button type="submit" className="btn-primary px-3.5 py-1.5 text-xs">
          Apply filters
        </button>
        {hasActiveFilters && (
          <Link href="/threats" className="btn-ghost text-xs">
            Clear filters
          </Link>
        )}
      </form>

      <ThreatsTable
        findings={data.findings}
        sortLinks={{ riskScore: sortHref("riskScore"), firstDetectedAt: sortHref("firstDetectedAt") }}
        currentSort={{ sortBy: sp.sortBy ?? "riskScore", sortDir: sp.sortDir ?? "desc" }}
      />

      <div className="mt-4 flex items-center justify-between text-sm">
        <Link
          href={hrefWith({ page: String(Math.max(1, data.page - 1)) })}
          aria-disabled={data.page <= 1}
          className={`btn-secondary px-3 py-1.5 text-xs ${data.page <= 1 ? "pointer-events-none opacity-40" : ""}`}
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" /> Previous
        </Link>
        <span className="text-ink-subtle">
          Page {data.page} of {totalPages}
        </span>
        <Link
          href={hrefWith({ page: String(Math.min(totalPages, data.page + 1)) })}
          aria-disabled={data.page >= totalPages}
          className={`btn-secondary px-3 py-1.5 text-xs ${data.page >= totalPages ? "pointer-events-none opacity-40" : ""}`}
        >
          Next <ChevronRightIcon className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
