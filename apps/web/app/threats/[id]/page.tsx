import { auth } from "@clerk/nextjs/server";
import { apiFetch, API_URL } from "../../../lib/api";
import { SeverityBadge } from "../../../components/SeverityBadge";
import { FindingLifecycle } from "../../../components/FindingLifecycle";
import { AiExplanationPanel } from "../../../components/AiExplanationPanel";
import { TakedownTracker } from "../../../components/TakedownTracker";
import { RelatedFindingsPanel } from "../../../components/RelatedFindingsPanel";

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
  websiteDataCurrent: boolean;
  downSince: string | null;
  underTakedownWatch: boolean;
  changes: Array<{ id: string; field: string; oldValue: string | null; newValue: string | null; detectedAt: string }>;
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

export default async function ThreatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { getToken } = await auth();
  const token = await getToken();
  const finding = await apiFetch<FindingDetail>(`/api/findings/${id}`, token);
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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-semibold text-ink">{finding.identifier}</h1>
        <SeverityBadge severity={finding.severity} />
        {finding.domainIntel?.firstResolvedAt && !finding.domainIntel.currentlyResolves && (
          <span
            title="This domain was confirmed registered/resolving at some point, but no longer resolves as of the last recheck."
            className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
          >
            No longer resolves
          </span>
        )}
        {onHold && (
          <span
            title="The registry status includes clientHold or serverHold: the domain is suspended and removed from DNS."
            className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800"
          >
            Suspended at registry
          </span>
        )}
        {finding.underTakedownWatch && (
          <span
            title={
              finding.downSince
                ? `Confirmed down since ${new Date(finding.downSince).toLocaleString()}. An alert fires if the site comes back.`
                : "Resolved or taken down, but not yet confirmed down by a scan. An alert fires if it's seen down and then live again."
            }
            className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800"
          >
            {finding.downSince ? "Down · watching for reactivation" : "Watching for reactivation"}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Risk score <span className="font-mono font-medium text-ink">{finding.riskScore}</span>/100 · source {finding.source}
      </p>

      <FindingLifecycle
        findingId={finding.id}
        initialStatus={finding.status}
        initialAssigneeId={finding.assigneeId}
        initialTags={finding.tags}
      />

      <section className="card mt-6 p-5">
        <h2 className="label">Why this score — itemized breakdown</h2>
        <ul className="mt-3 divide-y divide-line">
          {finding.scoreEvents.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-ink-muted">{e.reason}</span>
              <span className={`font-mono font-medium ${e.delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {e.delta >= 0 ? "+" : ""}
                {e.delta}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <AiExplanationPanel findingId={finding.id} initialExplanation={finding.aiExplanation} />

      <RelatedFindingsPanel findingId={finding.id} />

      {finding.websiteIntel?.screenshotPath && (
        <section className="card mt-6 p-5">
          <h2 className="label">Screenshot</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${API_URL}${finding.websiteIntel.screenshotPath}`}
            alt={`Screenshot of ${finding.identifier}`}
            className="mt-3 max-w-full rounded-md border border-line"
          />
        </section>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <h2 className="label">Domain intelligence</h2>
          <dl className="mt-3 space-y-1.5 text-sm">
            {di && <Row label="Registration status" value={resolutionStatus(di)} />}
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
                {di.registrarAbuseEmail && (
                  <Row label="Registrar" value={<AbuseContact email={di.registrarAbuseEmail} phone={di.registrarAbusePhone} />} />
                )}
                {di.hostingAbuseEmail && <Row label="Host" value={<AbuseContact email={di.hostingAbuseEmail} />} />}
              </dl>
            </div>
          )}
        </div>
        <div className="card p-5">
          <h2 className="label">Website intelligence</h2>
          {!finding.websiteDataCurrent && (
            <p
              title="The most recent recheck couldn't successfully scan this site (timeout, network error, or it's blocking automated requests) -- the data below is from an earlier successful scan, not the latest attempt."
              className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800"
            >
              {finding.websiteIntel
                ? "Showing data from an earlier scan -- the most recent recheck didn't succeed."
                : "This site has never been successfully scanned yet."}
            </p>
          )}
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Title" value={finding.websiteIntel?.title} />
            <Row label="HTTP status" value={finding.websiteIntel?.httpStatus != null ? String(finding.websiteIntel.httpStatus) : null} />
            <Row label="Login form" value={finding.websiteIntel?.hasLoginForm ? "Detected" : "Not detected"} />
            <Row label="Payment form" value={finding.websiteIntel?.hasPaymentForm ? "Detected" : "Not detected"} />
            <Row label="Looks parked" value={finding.websiteIntel?.looksParked ? "Yes" : "No"} />
            <Row
              label="Visual similarity"
              value={finding.websiteIntel ? (finding.websiteIntel.visualSimilarityMatch ? "Resembles real site" : "No match") : undefined}
            />
          </dl>
        </div>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="label">Evidence</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-muted">
          {finding.evidence.map((e) => (
            <li key={e.id}>{e.description}</li>
          ))}
          {finding.evidence.length === 0 && <li className="list-none text-ink-subtle">No evidence recorded.</li>}
        </ul>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="label">Registration &amp; site history</h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {finding.changes.map((c) => (
            <li key={c.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="shrink-0 font-mono text-xs text-ink-faint">{new Date(c.detectedAt).toLocaleString()}</span>
              <span className={c.field === "site" ? "font-medium text-red-700" : "text-ink-muted"}>
                <span className="font-medium text-ink">{CHANGE_LABELS[c.field] ?? c.field}:</span> {formatChangeValue(c.field, c.oldValue)} →{" "}
                {formatChangeValue(c.field, c.newValue)}
              </span>
            </li>
          ))}
          {finding.changes.length === 0 && (
            <li className="py-2 text-ink-subtle">No changes detected since monitoring began.</li>
          )}
        </ul>
      </section>

      <TakedownTracker findingId={finding.id} contacts={takedownContacts} siteLive={siteLive} />
    </div>
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
  if (field === "last_changed" || field === "expires") return new Date(value).toLocaleString();
  if (field === "site" && value.startsWith("down since ")) return `down since ${new Date(value.slice(11)).toLocaleString()}`;
  return value;
}

function formatDate(value: string | null | undefined): string | null {
  return value ? new Date(value).toLocaleString() : null;
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
// submission) -- both currently render as empty domain-intel fields otherwise, which is
// exactly what made a lapsed domain look identical to a currently-live one in the UI.
function resolutionStatus(domainIntel: { firstResolvedAt: string | null; currentlyResolves: boolean }): string {
  if (!domainIntel.firstResolvedAt) return "Never confirmed registered";
  if (domainIntel.currentlyResolves) return "Active";
  return `No longer resolves (first confirmed ${new Date(domainIntel.firstResolvedAt).toLocaleDateString()})`;
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-ink-subtle">{label}</dt>
      <dd className="text-right text-ink">{value ?? "—"}</dd>
    </div>
  );
}
