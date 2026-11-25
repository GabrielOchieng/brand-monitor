"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Maximize2, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { describeTarget } from "../../lib/format";
import { ACTION_STATUS_LABELS, ACTION_STATUS_TONE, CHANNEL_LABELS, KIND_LABELS } from "../../lib/autoTakedown";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Banner";
import { Skeleton } from "../Skeleton";
import { Ident, Pill, SeverityTag } from "../threat/atoms";
import { DraftEditor, useCanEditReports, type DraftsData } from "./ReportFlow";

type Props = {
  actionId: string;
  finding: { id: string; identifier: string; type: string; severity: string } | null;
  findingId: string;
  shadowVerdict: string | null;
  onClose: () => void;
  onChanged: () => void;
};

// The Takedowns page's side panel: one report with its conversation and every action its state
// allows, without leaving the queue.
export function ReportPanel({ actionId, finding, findingId, shadowVerdict, onClose, onChanged }: Props) {
  const canEdit = useCanEditReports();
  const [data, setData] = useState<DraftsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState(shadowVerdict);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<DraftsData>(`/api/findings/${findingId}/report-drafts`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [findingId]);

  useEffect(() => {
    setData(null);
    setError(null);
    setVerdict(shadowVerdict);
    load();
  }, [load, actionId, shadowVerdict]);

  const draft = data?.drafts.find((d) => d.id === actionId) ?? null;

  async function setShadowVerdict(v: "right" | "wrong") {
    const next = verdict === v ? null : v;
    setVerdict(next);
    try {
      await apiFetch(`/api/takedown-actions/${actionId}/verdict`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict: next }) });
      onChanged();
    } catch (err) {
      setVerdict(verdict);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <aside
      aria-label="Report details"
      className="sticky top-[calc(52px+12px+env(safe-area-inset-top))] flex max-h-[calc(100vh-76px)] min-w-0 flex-col overflow-y-auto rounded-r-md border border-l-0 border-border bg-card"
    >
      <div className="sticky top-0 z-[2] flex flex-col gap-2 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-subtle">
            {draft ? `${draft.reportRef} · ${CHANNEL_LABELS[draft.channel] ?? draft.channel} · ${KIND_LABELS[draft.kind] ?? draft.kind}` : " "}
          </span>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/threats/${findingId}?tab=takedown&report=${actionId}`}>
                <Maximize2 />
                Open threat
              </Link>
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel (Esc)">
              <X />
            </Button>
          </div>
        </div>
        {finding && (
          <h2 className="text-[16px] font-medium leading-snug">
            <Ident value={describeTarget(finding.identifier, finding.type).primary} highlight={finding.type !== "social"} />
          </h2>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          {finding && <SeverityTag severity={finding.severity} />}
          {draft && <Pill tone={ACTION_STATUS_TONE[draft.status]}>{ACTION_STATUS_LABELS[draft.status] ?? draft.status}</Pill>}
        </div>
        {draft?.status === "shadow" && canEdit && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">Would this report have been right to send?</span>
            <Button size="sm" variant={verdict === "right" ? "primary" : "secondary"} onClick={() => setShadowVerdict("right")} aria-pressed={verdict === "right"}>
              <ThumbsUp />
              Right
            </Button>
            <Button size="sm" variant={verdict === "wrong" ? "danger" : "secondary"} onClick={() => setShadowVerdict("wrong")} aria-pressed={verdict === "wrong"}>
              <ThumbsDown />
              Wrong
            </Button>
          </div>
        )}
      </div>
      <div className="px-4 pb-5 pt-3.5">
        {error ? (
          <Banner tone="error">{error}</Banner>
        ) : !data ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !draft ? (
          <p className="text-[13px] text-subtle">This report no longer exists.</p>
        ) : (
          <DraftEditor
            key={draft.id + draft.updatedAt}
            draft={draft}
            data={data}
            canEdit={canEdit}
            onChanged={async () => {
              await load();
              onChanged();
            }}
            onDeleted={() => {
              onClose();
              onChanged();
            }}
          />
        )}
      </div>
    </aside>
  );
}
