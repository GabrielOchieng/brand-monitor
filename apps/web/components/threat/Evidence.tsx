"use client";

import { useEffect, useRef, useState } from "react";
import { AtSign, ExternalLink, Lock, LockOpen } from "lucide-react";
import { API_URL } from "../../lib/api";
import { cleanSnippet, fullDate, timeAgo } from "../../lib/format";
import { cn } from "../../lib/cn";
import { SEV_TEXT } from "./atoms";
import type { FindingDetail } from "./types";

// The screenshot in a browser frame: the address, the HTTP status, and whether it's current.
export function ScreenshotFrame({ finding }: { finding: FindingDetail }) {
  const wi = finding.websiteIntel;
  const url = finding.type === "domain" ? `https://${finding.identifier}/` : finding.identifier;
  const https = url.startsWith("https://");
  const [missing, setMissing] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  // The image can fail before React attaches onError (it loads during hydration).
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setMissing(true);
  }, [wi?.screenshotPath]);

  return (
    <figure className="overflow-hidden rounded-md border border-border-strong bg-sunk">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 font-mono text-[11.5px] text-subtle">
        {https ? <Lock className="size-3.5 shrink-0 text-ok" aria-label="HTTPS" /> : <LockOpen className="size-3.5 shrink-0 text-sev-medium" aria-label="Not HTTPS" />}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{url}</span>
        {wi?.httpStatus != null && <span>HTTP {wi.httpStatus}</span>}
      </div>
      {wi?.screenshotPath && !missing ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={img} src={`${API_URL}${wi.screenshotPath}`} alt={`Screenshot of ${finding.identifier}`} onError={() => setMissing(true)} className="block w-full" />
      ) : (
        <div className="grid aspect-[16/7] place-items-center px-6 text-center text-[13px] text-subtle">
          {wi?.screenshotPath ? "Screenshot not available. A new one is taken on the next successful scan." : wi ? "No screenshot from the last successful scan." : "Not scanned successfully yet. The first scan normally runs within a few minutes."}
        </div>
      )}
      <figcaption className="flex flex-wrap justify-between gap-2 px-2.5 py-1.5 text-[11.5px] text-subtle">
        <span>
          {finding.websiteDataCurrent ? "From the latest scan" : wi ? <span className="text-sev-medium">From an earlier scan: the latest one couldn&apos;t load the site</span> : "Never scanned"}
          {wi?.scannedAt && <> · {timeAgo(wi.scannedAt)}</>}
        </span>
        <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-sev-medium hover:underline" title="Opens the suspicious site itself">
          Open the suspicious site <ExternalLink className="size-3" />
        </a>
      </figcaption>
    </figure>
  );
}

const PLATFORM_LABELS: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", x: "X", telegram: "Telegram", youtube: "YouTube" };

// A social finding is never scanned (the platforms block it): this is what a search engine showed
// about the account, which is what it was scored on.
export function SocialCard({ finding }: { finding: FindingDetail }) {
  const intel = finding.socialIntel;
  const text = cleanSnippet(intel?.snippet ?? null, intel?.title);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-strong bg-sunk p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-full bg-raised text-muted-foreground">
          <AtSign className="size-4" />
        </span>
        <div className="min-w-0">
          <a href={finding.identifier} target="_blank" rel="noopener noreferrer" className="block truncate font-mono text-[13px] text-primary hover:underline">
            {intel?.handle ? `@${intel.handle}` : finding.identifier}
          </a>
          <div className="text-xs text-subtle">
            {intel ? (PLATFORM_LABELS[intel.platform] ?? intel.platform) : "Social account"}
            {intel && <> · first seen {timeAgo(intel.firstSeenAt)} · last seen in search {timeAgo(intel.lastSeenAt)}</>}
          </div>
        </div>
      </div>
      {(intel?.title || text) && (
        <blockquote className="rounded-sm border-l-2 border-border-strong pl-3 text-[13px] text-muted-foreground">
          {intel?.title && <p className="font-medium text-foreground">{intel.title}</p>}
          {text && <p className="mt-1 whitespace-pre-wrap">{text}</p>}
        </blockquote>
      )}
      {intel?.postUrl && (
        <a href={intel.postUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
          Open the post that was seen
        </a>
      )}
      <p className="text-xs text-subtle">
        From search-engine results; the platform itself isn&apos;t scanned. Report the account on the platform; a confirmed impersonation can also go through Meta Brand Rights
        Protection.
      </p>
    </div>
  );
}

// "Why this score": each rule's contribution, biggest first, and the total.
export function ScoreReasons({ finding }: { finding: FindingDetail }) {
  const events = [...finding.scoreEvents].sort((a, b) => b.delta - a.delta);
  if (events.length === 0) return <p className="text-[13px] text-subtle">Not scored yet.</p>;
  return (
    <div>
      <ul className="flex flex-col">
        {events.map((e) => (
          <li key={e.id} className="grid grid-cols-[44px_1fr] gap-2.5 border-b border-dashed border-border py-2 text-[13px] last:border-b-0">
            <span
              className={cn(
                "text-right font-mono text-[12.5px] font-medium tabular",
                e.delta < 0 ? "text-ok" : e.delta >= 20 ? "text-sev-critical" : e.delta >= 10 ? "text-sev-high" : "text-subtle"
              )}
            >
              {e.delta >= 0 ? "+" : ""}
              {e.delta}
            </span>
            <span className="text-muted-foreground">{e.reason}</span>
          </li>
        ))}
      </ul>
      <div className="mt-0.5 flex items-baseline justify-between border-t border-border-strong pt-2.5 text-[13px]">
        <span className="text-muted-foreground">Risk score</span>
        <b className={cn("font-mono text-lg", SEV_TEXT[finding.severity])}>
          {finding.riskScore}
          <span className="text-xs font-normal text-subtle">/100</span>
        </b>
      </div>
    </div>
  );
}

export function KV({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[minmax(110px,auto)_1fr] sm:gap-y-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-subtle">{k}</dt>
          <dd className="mb-1.5 min-w-0 [overflow-wrap:anywhere] sm:mb-0">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// The handful of facts an analyst checks first; the Infrastructure tab has the rest.
export function KeyFacts({ finding }: { finding: FindingDetail }) {
  const di = finding.domainIntel;
  const wi = finding.websiteIntel;
  if (finding.type === "social") return null;
  return (
    <KV
      rows={[
        ["Registered", di?.registeredAt ? <span title={fullDate(di.registeredAt)}>{timeAgo(di.registeredAt)}</span> : null],
        ["Registrar", di?.registrar],
        ["Hosting", di?.hostingOrg],
        ["IP", di?.ip ? <span className="font-mono">{di.ip}</span> : null],
        ["Login form", wi ? (wi.hasLoginForm ? <span className="text-sev-high">Yes</span> : "No") : null],
        ["Payment form", wi ? (wi.hasPaymentForm ? <span className="text-sev-high">Yes</span> : "No") : null],
        ["Looks like your site", wi ? (wi.visualSimilarityMatch ? <span className="text-sev-critical">Yes</span> : "No") : null],
      ]}
    />
  );
}
