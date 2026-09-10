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
  } | null;
  websiteIntel: {
    screenshotPath: string | null;
    title: string | null;
    metaDescription: string | null;
    hasLoginForm: boolean;
    hasPaymentForm: boolean;
    looksParked: boolean;
    visualSimilarityMatch: boolean;
  } | null;
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

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-100">{finding.identifier}</h1>
        <SeverityBadge severity={finding.severity} />
        {finding.domainIntel?.firstResolvedAt && !finding.domainIntel.currentlyResolves && (
          <span
            title="This domain was confirmed registered/resolving at some point, but no longer resolves as of the last recheck."
            className="rounded border border-amber-600/40 bg-amber-600/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300"
          >
            No longer resolves
          </span>
        )}
      </div>
      <p className="mt-1 text-gray-400">
        Risk score <span className="font-mono text-gray-200">{finding.riskScore}</span>/100 · source {finding.source}
      </p>

      <FindingLifecycle
        findingId={finding.id}
        initialStatus={finding.status}
        initialAssigneeId={finding.assigneeId}
        initialTags={finding.tags}
      />

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Why this score — itemized breakdown</h2>
        <ul className="mt-3 divide-y divide-gray-800 rounded border border-gray-800">
          {finding.scoreEvents.map((e) => (
            <li key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-gray-300">{e.reason}</span>
              <span className={`font-mono ${e.delta >= 0 ? "text-green-400" : "text-red-400"}`}>
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
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Screenshot</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${API_URL}${finding.websiteIntel.screenshotPath}`}
            alt={`Screenshot of ${finding.identifier}`}
            className="mt-3 max-w-full rounded border border-gray-800"
          />
        </section>
      )}

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Domain intelligence</h2>
          <dl className="mt-3 space-y-1 text-sm">
            {finding.domainIntel && <Row label="Registration status" value={resolutionStatus(finding.domainIntel)} />}
            <Row label="Registrar" value={finding.domainIntel?.registrar} />
            <Row label="Registered" value={finding.domainIntel?.registeredAt ? new Date(finding.domainIntel.registeredAt).toLocaleString() : null} />
            <Row label="IP" value={finding.domainIntel?.ip} />
            <Row label="Nameservers" value={finding.domainIntel?.nameservers?.join(", ")} />
            <Row label="WHOIS source" value={finding.domainIntel?.whoisSource} />
          </dl>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Website intelligence</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <Row label="Title" value={finding.websiteIntel?.title} />
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

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Evidence</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-300">
          {finding.evidence.map((e) => (
            <li key={e.id}>{e.description}</li>
          ))}
          {finding.evidence.length === 0 && <li className="text-gray-500">No evidence recorded.</li>}
        </ul>
      </section>

      <TakedownTracker findingId={finding.id} />
    </div>
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

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-200">{value ?? "—"}</dd>
    </div>
  );
}
