"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Maximize2, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { describeTarget, sourceLabel, timeAgo } from "../../lib/format";
import { Button } from "../ui/Button";
import { SectionTitle } from "../ui/Panel";
import { Skeleton } from "../Skeleton";
import { Ident, ScoreMeter, SeverityTag, StatusPill, WebState } from "./atoms";
import { KeyFacts, ScoreReasons, ScreenshotFrame, SocialCard } from "./Evidence";
import { ThreatActionButtons, useCanAct } from "./useThreatActions";
import { detailWebState, type FindingDetail } from "./types";

type Props = {
  id: string;
  index: number;
  total: number;
  status: string;
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

// The desktop triage panel beside the list: enough to decide without leaving the queue.
export function ThreatPanel({ id, index, total, status, onStep, onClose, onConfirm, onDismiss }: Props) {
  const canAct = useCanAct();
  const [finding, setFinding] = useState<FindingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFinding(null);
    setError(null);
    apiFetch<FindingDetail>(`/api/findings/${id}`)
      .then((f) => !cancelled && setFinding(f))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const target = finding ? describeTarget(finding.identifier, finding.type) : null;

  return (
    <aside
      aria-label="Threat details"
      className="sticky top-[calc(52px+12px+env(safe-area-inset-top))] flex max-h-[calc(100vh-76px)] min-w-0 flex-col overflow-y-auto rounded-r-md border border-l-0 border-border bg-card"
    >
      <div className="sticky top-0 z-[2] flex flex-col gap-2.5 border-b border-border bg-card px-4 pb-3 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" onClick={() => onStep(-1)} disabled={index <= 0} aria-label="Previous threat (k)">
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => onStep(1)} disabled={index >= total - 1} aria-label="Next threat (j)">
              <ChevronDown />
            </Button>
            <span className="ml-1 font-mono text-xs text-subtle tabular">
              {index + 1} of {total}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/threats/${id}`}>
                <Maximize2 />
                Full page
              </Link>
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel (Esc)">
              <X />
            </Button>
          </div>
        </div>
        {finding && target ? (
          <>
            <h2 className="text-[16px] font-medium leading-snug">
              <Ident value={target.primary} highlight={finding.type !== "social"} />
              {target.secondary && <span className="block truncate font-sans text-xs font-normal text-subtle">{target.secondary}</span>}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <SeverityTag severity={finding.severity} />
              <ScoreMeter score={finding.riskScore} severity={finding.severity} />
              <StatusPill status={status} />
              <WebState state={detailWebState(finding)} />
              <span className="text-xs text-subtle">
                {sourceLabel(finding.source)} · {timeAgo(finding.firstDetectedAt)}
              </span>
            </div>
            {canAct && (
              <div className="flex flex-wrap gap-1.5">
                <ThreatActionButtons id={id} type={finding.type} status={status} compact onConfirm={onConfirm} onDismiss={onDismiss} takedownHref={`/threats/${id}?tab=takedown`} />
              </div>
            )}
          </>
        ) : error ? (
          <p className="text-[13px] text-sev-critical">{error}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
      </div>
      {finding && (
        <div className="flex flex-col gap-4 px-4 pb-5 pt-3.5">
          {finding.type === "social" ? <SocialCard finding={finding} /> : <ScreenshotFrame finding={finding} />}
          <div>
            <SectionTitle>Why this score</SectionTitle>
            <ScoreReasons finding={finding} />
          </div>
          {finding.type !== "social" && (
            <div>
              <SectionTitle
                action={
                  <Link href={`/threats/${id}?tab=infrastructure`} className="text-xs text-primary hover:underline">
                    Infrastructure →
                  </Link>
                }
              >
                Key facts
              </SectionTitle>
              <KeyFacts finding={finding} />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
