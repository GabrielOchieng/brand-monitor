import Link from "next/link";
import { API_URL } from "../../../lib/api";
import { serverApiFetch } from "../../../lib/serverApi";
import { SeverityBadge } from "../../../components/SeverityBadge";
import { FindingLifecycle } from "../../../components/FindingLifecycle";
import { AiExplanationPanel } from "../../../components/AiExplanationPanel";
import { TakedownTracker } from "../../../components/TakedownTracker";
import { RelatedFindingsPanel } from "../../../components/RelatedFindingsPanel";
import { ScreenshotImage } from "../../../components/ScreenshotImage";
import { IndicatorsPanel, type FindingIndicatorView } from "../../../components/IndicatorsPanel";
import { ReportDrafts } from "../../../components/ReportDrafts";
import { TargetIcon } from "../../../components/ThreatsTable";
import { ChevronDownIcon, ChevronLeftIcon, ExternalLinkIcon } from "../../../components/icons";
import { cleanSnippet, describeTarget, fullDate, sourceLabel, statusLabel, STATUS_PILL, timeAgo } from "../../../lib/format";

interface FindingDetail {
  id: string;
  identifier: string;
  riskScore: number;
  severity: string;
  status: string;
  source: string;
  assigneeId: string | null;
  tags: string[];
  firstDetectedAt: string;
  lastScannedAt: string;
  domainIntel: {
    registrar: string | null;
    registeredAt: string | null;
    nameservers: string[];
    ip: string | null;
    whoisSource: string | null;
    firstResolvedAt: string | null;
    currentlyResolves: boolean;
    lastChangedAt: string | null;
    expiresAt: string | null;
    statusCodes: string[];
    registrarAbuseEmail: string | null;
    registrarAbusePhone: string | null;
    hostingOrg: string | null;
    hostingAbuseEmail: string | null;
  } | null;
  websiteIntel: {
    screenshotPath: string | null;
    title: string | null;
    metaDescription: string | null;
    hasLoginForm: boolean;
    hasPaymentForm: boolean;
    looksParked: boolean;
    httpStatus: number | null;
    visualSimilarityMatch: boolean;
  } | null;
  socialIntel: {
    platform: string;
    handle: string | null;
    postUrl: string | null;
    title: string | null;
    snippet: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  } | null;
  type: string;
  websiteDataCurrent: boolean;
  downSince: string | null;
  underTakedownWatch: boolean;
  changes: Array<{ id: string; field: string; oldValue: string | null; newValue: string | null; detectedAt: string }>;
  indicators: FindingIndicatorView[];
  publicReports: Array<{ id: string; url: string | null; phone: string | null; description: string | null; status: string; createdAt: string }>;
  evidence: Array<{ id: string; description: string }>;
  scoreEvents: Array<{ id: string; delta: number; reason: string; ruleCode: string }>;
  aiExplanation: {
    status: "pending" | "succeeded" | "failed";
    response: string | null;
    error: string | null;
    model: string;
    createdAt: string;
  } | null;
}

// Two columns: on the left what the threat is and why it scored (screenshot or social
// post, score breakdown, AI summary, contacts, reports, related findings); on the right
// what to do about it (status, takedowns) and the reference details, folded where long.
export default async function ThreatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const finding = await serverApiFetch<FindingDetail>(`/api/findings/${id}`);
  const di = finding.domainIntel;
  const onHold = Boolean(di?.statusCodes.some((s) => s === "clientHold" || s === "serverHold"));
  const siteLive = Boolean(
    finding.websiteDataCurrent && finding.websiteIntel && !finding.websiteIntel.looksParked && ![404, 410, 451].includes(finding.websiteIntel.httpStatus ?? 0)
  );
  const takedownContacts = [
    di?.registrar && {
      provider: `${di.registrar} (registrar)`,
      contact: [di.registrarAbuseEmail, di.registrarAbusePhone].filter(Boolean).join(", ") || null,
    },
    di?.hostingOrg && { provider: `${di.hostingOrg} (hosting)`, contact: di.hostingAbuseEmail },
  ].filter((c): c is { provider: string; contact: string | null } => Boolean(c));

  const target = describeTarget(finding.identifier, finding.type);
  const isSocial = finding.type === "social";
  const maxDelta = Math.max(1, ...finding.scoreEvents.map((e) => Math.abs(e.delta)));
  const openUrl = finding.type === "domain" ? `https://${finding.identifier}` : finding.identifier;

  return (
    <div>
      <Link href="/threats" className="inline-flex items-center gap-1 text-sm text-ink-subtle hover:text-ink">
        <ChevronLeftIcon className="h-4 w-4" /> Threats
      </Link>

      {/* What it is, how bad, where it stands */}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <TargetIcon type={finding.type} platform={target.platform} />
          <div className="min-w-0">
            <h1 className={`break-all text-xl font-semibold tracking-tight text-ink sm:text-2xl ${isSocial ? "" : "ident"}`}>{target.primary}</h1>
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-0.5 inline-flex max-w-full items-center gap-1 text-sm text-ink-subtle hover:text-brand"
              title="Opens the suspicious site itself"
              aria-label={`Open the suspicious site ${finding.identifier} in a new tab`}
            >
              <span className="truncate">{target.secondary ?? finding.identifier}</span>
              <span className="shrink-0 text-xs text-amber-700">· suspicious site, opens in a new tab</span>
              <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
            </a>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5">
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Risk</div>
            <div className="text-2xl font-semibold tabular-nums text-ink">
              {finding.riskScore}
              <span className="text-sm font-normal text-ink-faint">/100</span>
            </div>
          </div>
          <SeverityBadge severity={finding.severity} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
        <span className={`rounded-full border px-2 py-0.5 font-medium ${STATUS_PILL[finding.status] ?? STATUS_PILL.new}`}>{statusLabel(finding.status)}</span>
        <span>· {sourceLabel(finding.source)}</span>
        <span title={fullDate(finding.firstDetectedAt)}>· found {timeAgo(finding.firstDetectedAt)}</span>
        {finding.lastScannedAt && <span title={fullDate(finding.lastScannedAt)}>· checked {timeAgo(finding.lastScannedAt)}</span>}
        {di?.firstResolvedAt && !di.currentlyResolves && (
          <StateBadge tone="amber" title="Confirmed registered at some point, but it no longer resolves as of the last recheck.">
            No longer resolves
          </StateBadge>
        )}
        {onHold && (
          <StateBadge tone="emerald" title="The registry status includes clientHold or serverHold: the domain is suspended and removed from DNS.">
            Suspended at registry
          </StateBadge>
        )}
        {finding.underTakedownWatch && (
          <StateBadge
            tone="sky"
            title={
              finding.downSince
                ? `Confirmed down since ${fullDate(finding.downSince)}. An alert fires if the site comes back.`
                : "Resolved or taken down, but not yet confirmed down by a scan. An alert fires if it's seen down and then live again."
            }
          >
            {finding.downSince ? "Down · watching for reactivation" : "Watching for reactivation"}
          </StateBadge>
        )}
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-3">
        {/* The evidence */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {isSocial ? (
            <SocialAccountPanel identifier={finding.identifier} intel={finding.socialIntel} />
          ) : (
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <h2 className="label">Screenshot</h2>
                {!finding.websiteDataCurrent && finding.websiteIntel && <span className="text-xs text-amber-700">From an earlier scan</span>}
              </div>
              {finding.websiteIntel?.screenshotPath ? (
                <ScreenshotImage src={`${API_URL}${finding.websiteIntel.screenshotPath}`} alt={`Screenshot of ${finding.identifier}`} />
              ) : (
                <div className="flex aspect-16/7 items-center justify-center bg-elevated/50 px-6 text-center text-sm text-ink-subtle">
                  {finding.websiteIntel ? "No screenshot from the last successful scan." : "Not scanned successfully yet. The first scan normally runs within a few minutes."}
                </div>
              )}
            </section>
          )}

          <section className="card p-5">
            <h2 className="label">Why this score</h2>
            {finding.scoreEvents.length === 0 ? (
              <p className="mt-3 text-sm text-ink-subtle">Not scored yet.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {finding.scoreEvents.map((e) => (
                  <li key={e.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 text-sm sm:grid-cols-[1fr_8rem_3rem]">
                    <span className="text-ink-muted">{e.reason}</span>
                    <span className="hidden h-1.5 overflow-hidden rounded-full bg-elevated sm:block">
                      <span
                        className={`block h-full rounded-full ${e.delta >= 0 ? "bg-brand" : "bg-emerald-500"}`}
                        style={{ width: `${(Math.abs(e.delta) / maxDelta) * 100}%` }}
                      />
                    </span>
                    <span className={`text-right font-mono font-medium tabular-nums ${e.delta >= 0 ? "text-ink" : "text-emerald-700"}`}>
                      {e.delta >= 0 ? "+" : ""}
                      {e.delta}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <AiExplanationPanel findingId={finding.id} initialExplanation={finding.aiExplanation} />

          <IndicatorsPanel indicators={finding.indicators ?? []} />

          {(finding.publicReports ?? []).length > 0 && (
            <section className="card p-5">
              <h2 className="label">Reported by the public ({finding.publicReports.length})</h2>
              <ul className="mt-3 divide-y divide-line">
                {finding.publicReports.map((r) => (
                  <li key={r.id} className={`py-2.5 text-sm ${r.status === "dismissed" ? "opacity-50" : ""}`}>
                    <div className="text-xs text-ink-subtle">
                      <span title={fullDate(r.createdAt)}>{timeAgo(r.createdAt)}</span> · {r.status}
                      {r.phone && (
                        <>
                          {" "}
                          · number given: <span className="font-mono">{r.phone}</span>
                        </>
                      )}
                    </div>
                    {r.description ? <p className="mt-0.5 whitespace-pre-wrap text-ink-muted">{r.description}</p> : <p className="mt-0.5 text-ink-subtle">(no description)</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <RelatedFindingsPanel findingId={finding.id} />
        </div>

        {/* What to do about it, and the details */}
        <div className="min-w-0 space-y-6">
          <FindingLifecycle findingId={finding.id} initialStatus={finding.status} initialAssigneeId={finding.assigneeId} initialTags={finding.tags} />

          <TakedownTracker findingId={finding.id} contacts={takedownContacts} siteLive={siteLive} />

          {!isSocial && <ReportDrafts findingId={finding.id} />}

          {!isSocial && (
            <section className="card p-5">
              <h2 className="label">Website</h2>
              {!finding.websiteDataCurrent && (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  {finding.websiteIntel ? "The latest recheck couldn't scan the site; this is from an earlier scan." : "Never scanned successfully yet."}
                </p>
              )}
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row label="Title" value={finding.websiteIntel?.title} />
                <Row label="HTTP status" value={finding.websiteIntel?.httpStatus != null ? String(finding.websiteIntel.httpStatus) : null} />
                <Row label="Login form" value={finding.websiteIntel ? (finding.websiteIntel.hasLoginForm ? "Yes" : "No") : null} />
                <Row label="Payment form" value={finding.websiteIntel ? (finding.websiteIntel.hasPaymentForm ? "Yes" : "No") : null} />
                <Row label="Parked page" value={finding.websiteIntel ? (finding.websiteIntel.looksParked ? "Yes" : "No") : null} />
                <Row label="Looks like the real site" value={finding.websiteIntel ? (finding.websiteIntel.visualSimilarityMatch ? "Yes" : "No") : null} />
              </dl>
            </section>
          )}

          {!isSocial && (
            <details className="card group p-5" open={finding.type === "domain"}>
              <summary className="flex cursor-pointer list-none items-center justify-between">
                <h2 className="label">Domain</h2>
                <ChevronDownIcon className="h-4 w-4 text-ink-subtle transition-transform group-open:rotate-180" />
              </summary>
              <dl className="mt-3 space-y-1.5 text-sm">
                {di && <Row label="Status" value={resolutionStatus(di)} />}
                <Row label="Registrar" value={di?.registrar} />
                <Row label="Registered" value={formatDate(di?.registeredAt)} />
                <Row label="Last changed" value={formatDate(di?.lastChangedAt)} />
                <Row label="Expires" value={formatDate(di?.expiresAt)} />
                <Row label="Registry status" value={di?.statusCodes.length ? di.statusCodes.join(", ") : null} />
                <Row label="IP" value={di?.ip} />
                <Row label="Hosting" value={di?.hostingOrg} />
                <Row label="Nameservers" value={di?.nameservers?.join(", ")} />
                <Row label="WHOIS source" value={di?.whoisSource} />
              </dl>
              {(di?.registrarAbuseEmail || di?.hostingAbuseEmail) && (
                <div className="mt-4 border-t border-line pt-3">
                  <h3 className="label">Report abuse to</h3>
                  <dl className="mt-2 space-y-1.5 text-sm">
                    {di.registrarAbuseEmail && <Row label="Registrar" value={<AbuseContact email={di.registrarAbuseEmail} phone={di.registrarAbusePhone} />} />}
                    {di.hostingAbuseEmail && <Row label="Host" value={<AbuseContact email={di.hostingAbuseEmail} />} />}
                  </dl>
                </div>
              )}
            </details>
          )}

          <details className="card group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between">
              <h2 className="label">History ({finding.changes.length + finding.evidence.length})</h2>
              <ChevronDownIcon className="h-4 w-4 text-ink-subtle transition-transform group-open:rotate-180" />
            </summary>
            <h3 className="mt-4 text-xs font-medium text-ink-muted">Registration and site changes</h3>
            <ul className="mt-2 divide-y divide-line text-sm">
              {finding.changes.map((c) => (
                <li key={c.id} className="py-2">
                  <div className="text-xs text-ink-faint" title={fullDate(c.detectedAt)}>
                    {timeAgo(c.detectedAt)}
                  </div>
                  <div className={c.field === "site" ? "font-medium text-red-700" : "text-ink-muted"}>
                    <span className="font-medium text-ink">{CHANGE_LABELS[c.field] ?? c.field}:</span> {formatChangeValue(c.field, c.oldValue)} →{" "}
                    {formatChangeValue(c.field, c.newValue)}
                  </div>
                </li>
              ))}
              {finding.changes.length === 0 && <li className="py-2 text-xs text-ink-subtle">No changes since monitoring began.</li>}
            </ul>
            <h3 className="mt-4 text-xs font-medium text-ink-muted">Evidence recorded across scans</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
              {finding.evidence.map((e) => (
                <li key={e.id}>{e.description}</li>
              ))}
              {finding.evidence.length === 0 && <li className="list-none text-xs text-ink-subtle">None yet.</li>}
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}

function StateBadge({ tone, title, children }: { tone: "amber" | "emerald" | "sky"; title: string; children: React.ReactNode }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
  };
  return (
    <span title={title} className={`rounded-full border px-2 py-0.5 font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
  telegram: "Telegram",
  youtube: "YouTube",
};

// A social finding is never scanned (the platforms block it) -- this is what a search
// engine showed about the account, which is what it was scored on.
function SocialAccountPanel({ identifier, intel }: { identifier: string; intel: FindingDetail["socialIntel"] }) {
  const text = cleanSnippet(intel?.snippet ?? null, intel?.title);
  return (
    <section className="card p-5">
      <h2 className="label">Social account</h2>
      <dl className="mt-3 space-y-1.5 text-sm">
        <Row label="Platform" value={intel ? (PLATFORM_LABELS[intel.platform] ?? intel.platform) : null} />
        <Row
          label="Account"
          value={
            <a href={identifier} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:text-brand-hover hover:underline">
              {intel?.handle ? `@${intel.handle}` : identifier}
            </a>
          }
        />
        {intel?.postUrl && (
          <Row
            label="Post seen"
            value={
              <a href={intel.postUrl} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:text-brand-hover hover:underline">
                Open post
              </a>
            }
          />
        )}
        <Row label="First seen" value={intel ? <span title={fullDate(intel.firstSeenAt)}>{timeAgo(intel.firstSeenAt)}</span> : null} />
        <Row label="Last seen in search" value={intel ? <span title={fullDate(intel.lastSeenAt)}>{timeAgo(intel.lastSeenAt)}</span> : null} />
      </dl>
      {(intel?.title || text) && (
        <blockquote className="mt-4 rounded-md border border-line bg-elevated/40 px-4 py-3 text-sm text-ink-muted">
          {intel?.title && <p className="font-medium text-ink">{intel.title}</p>}
          {text && <p className="mt-1 whitespace-pre-wrap">{text}</p>}
        </blockquote>
      )}
      <p className="mt-3 text-xs text-ink-subtle">
        From search-engine results; the platform itself isn&apos;t scanned. Report the account on the platform; a confirmed impersonation can also go through
        Meta Brand Rights Protection.
      </p>
    </section>
  );
}

const CHANGE_LABELS: Record<string, string> = {
  registrar: "Registrar",
  nameservers: "Nameservers",
  last_changed: "Registration updated",
  expires: "Expiry",
  status: "Registry status",
  ip: "IP",
  site: "Website",
};

function formatChangeValue(field: string, value: string | null): string {
  if (!value) return "—";
  if (field === "last_changed" || field === "expires") return fullDate(value);
  if (field === "site" && value.startsWith("down since ")) return `down since ${fullDate(value.slice(11))}`;
  return value;
}

function formatDate(value: string | null | undefined): string | null {
  return value ? fullDate(value) : null;
}

function AbuseContact({ email, phone }: { email: string | null; phone?: string | null }) {
  if (!email && !phone) return null;
  return (
    <span className="break-all">
      {email && (
        <a href={`mailto:${email}`} className="text-brand hover:text-brand-hover hover:underline">
          {email}
        </a>
      )}
      {email && phone && " · "}
      {phone}
    </span>
  );
}

// "Lapsed" (was confirmed resolving, isn't now) is a distinct state from "never
// confirmed" (a candidate we've never seen resolve at all, e.g. a fresh manual
// submission) -- both would otherwise render as empty domain fields, which is exactly
// what made a lapsed domain look identical to a live one.
function resolutionStatus(domainIntel: { firstResolvedAt: string | null; currentlyResolves: boolean }): string {
  if (!domainIntel.firstResolvedAt) return "Never confirmed registered";
  if (domainIntel.currentlyResolves) return "Active";
  return `No longer resolves (first confirmed ${new Date(domainIntel.firstResolvedAt).toLocaleDateString()})`;
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-ink-subtle">{label}</dt>
      <dd className="min-w-0 wrap-break-word text-right text-ink">{value ?? "—"}</dd>
    </div>
  );
}
