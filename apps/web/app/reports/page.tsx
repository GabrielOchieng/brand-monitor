"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Clock, Copy, Link2, Phone, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useBrands } from "../../lib/brand";
import { useSession } from "../../lib/session";
import { fullDate, timeAgo } from "../../lib/format";
import { cn } from "../../lib/cn";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { EmptyState } from "../../components/ui/EmptyState";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/Tabs";
import { useToast } from "../../components/ui/Toast";
import { Ident, Pill, SeverityTag } from "../../components/threat/atoms";
import { LoadingRegion, SkeletonList } from "../../components/Skeleton";

interface FindingRef {
  id: string;
  identifier: string;
  severity: string;
}

interface Report {
  id: string;
  brandId: string;
  url: string | null;
  phone: string | null;
  description: string | null;
  reporterEmail: string | null;
  status: string;
  scanQueued: boolean;
  createdAt: string;
  finding: FindingRef | null;
  matchedFindings: FindingRef[];
}

const STATUSES = [
  ["new", "New"],
  ["reviewed", "Reviewed"],
  ["dismissed", "Dismissed"],
  ["all", "All"],
] as const;

// Scams reported by customers and staff through the public form (/report/<token>).
export default function ReportsPage() {
  const { brands } = useBrands();
  const { me, role } = useSession();
  const toast = useToast();
  const canAct = !me?.adminView && (role === "owner" || role === "admin" || role === "analyst");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [status, setStatus] = useState<string>("new");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setReports(await apiFetch<Report[]>(`/api/reports${status !== "all" ? `?status=${status}` : ""}`));
  }, [status]);

  useEffect(() => {
    setReports(null);
    load().catch((e) => setError(String(e?.message ?? e)));
  }, [load]);

  async function setReportStatus(r: Report, next: string) {
    setError("");
    try {
      await apiFetch(`/api/reports/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
      toast(next === "reviewed" ? "Marked reviewed" : next === "dismissed" ? "Dismissed" : "Moved back to New");
      await load();
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setError(err?.status === 403 ? "Your role can't change reports. Ask an analyst, admin or owner." : String(err?.message ?? e));
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const withLink = (brands ?? []).filter((b) => b.reportToken);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Link copied");
    } catch {
      toast({ message: "Couldn't copy. Select the link and copy it yourself.", tone: "error" });
    }
  }

  return (
    <div>
      <PageHeader
        title="Public reports"
        description="Scams reported by customers and staff through your public form. Links are scanned automatically (up to 30 a day per brand); phone numbers are matched against contact details on existing threats."
      />

      {brands && (
        <Banner
          className="mb-4"
          icon={<Link2 />}
          action={
            <Link href="/brands?tab=report-form" className="whitespace-nowrap text-[12.5px] text-primary hover:underline">
              Form settings →
            </Link>
          }
        >
          {withLink.length === 0 ? (
            "The public report form is off for every brand. Turn it on to give customers a way to report scams."
          ) : (
            <span className="flex flex-col gap-1.5">
              {withLink.map((b) => (
                <span key={b.id} className="flex min-w-0 flex-wrap items-center gap-2">
                  {withLink.length > 1 && <b className="font-medium text-foreground">{b.name}:</b>}
                  <span className="min-w-0 truncate font-mono text-xs text-foreground select-all">{`${origin}/report/${b.reportToken}`}</span>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => copy(`${origin}/report/${b.reportToken}`)}>
                    <Copy />
                    Copy
                  </Button>
                </span>
              ))}
            </span>
          )}
        </Banner>
      )}

      <Tabs value={status} onValueChange={setStatus}>
        <TabsList className="mb-3">
          {STATUSES.map(([k, l]) => (
            <TabsTrigger key={k} value={k}>
              {l}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      {!reports ? (
        <LoadingRegion label="Loading reports">
          <SkeletonList rows={4} lines={2} />
        </LoadingRegion>
      ) : reports.length === 0 ? (
        <EmptyState title="No reports here">{status === "new" ? "Nothing new from the public form." : "No reports in this state."}</EmptyState>
      ) : (
        <ul className="rounded-md border border-border bg-card">
          {reports.map((r) => {
            const links = [...(r.finding ? [{ ...r.finding, why: "Reported link" }] : []), ...r.matchedFindings.map((f) => ({ ...f, why: "Same contact details" }))];
            return (
              <li key={r.id} className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border p-3.5 text-[13px] last:border-b-0", r.status === "dismissed" && status === "all" && "opacity-60")}>
                <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                    {r.url && <Ident value={r.url} highlight={false} />}
                    {r.phone && (
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        <Phone className="size-3.5 text-subtle" />
                        {r.phone}
                      </span>
                    )}
                    {status === "all" && <Pill tone={r.status === "new" ? "info" : "neutral"}>{r.status[0].toUpperCase() + r.status.slice(1)}</Pill>}
                  </div>
                  {r.description && <p className="whitespace-pre-wrap text-muted-foreground">&ldquo;{r.description}&rdquo;</p>}
                  <div className="text-xs text-subtle">
                    <span title={fullDate(r.createdAt)}>{timeAgo(r.createdAt)}</span>
                    {r.reporterEmail ? (
                      <>
                        {" "}
                        · from <span className="font-mono">{r.reporterEmail}</span>
                      </>
                    ) : (
                      " · anonymous"
                    )}
                  </div>
                  {links.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-xs">
                      {links.map((f) => (
                        <li key={f.id + f.why} className="flex flex-wrap items-center gap-2">
                          <span className="text-subtle">{f.why}:</span>
                          <Link href={`/threats/${f.id}`} className="hover:text-primary">
                            <Ident value={f.identifier} />
                          </Link>
                          <SeverityTag severity={f.severity} />
                        </li>
                      ))}
                    </ul>
                  ) : r.url ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-sev-medium">
                      <Clock className="size-3.5" />
                      {r.scanQueued ? "No known threat matches. The link is queued for a scan." : "Not scanned: the daily cap was reached, or it's the brand's own site or a contact link."}
                    </span>
                  ) : null}
                </div>
                {canAct && (
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {r.status !== "reviewed" && (
                      <Button size="sm" onClick={() => setReportStatus(r, "reviewed")}>
                        <Check />
                        Reviewed
                      </Button>
                    )}
                    {r.status !== "dismissed" && (
                      <Button size="sm" variant="ghost" onClick={() => setReportStatus(r, "dismissed")}>
                        <X />
                        Dismiss
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
