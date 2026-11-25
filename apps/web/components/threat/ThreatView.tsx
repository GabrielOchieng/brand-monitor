"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Eye, PauseCircle, ShieldOff, Unplug } from "lucide-react";
import { describeTarget, fullDate, sourceLabel, statusLabel, timeAgo } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import { FindingLifecycle } from "../FindingLifecycle";
import { AiExplanationPanel } from "../AiExplanationPanel";
import { IndicatorsPanel } from "../IndicatorsPanel";
import { RelatedFindingsPanel } from "../RelatedFindingsPanel";
import { ReportFlow } from "../takedown/ReportFlow";
import { TakedownLog } from "../takedown/TakedownLog";
import { Ident, Pill, ScoreMeter, SeverityTag, StatusPill, TypeTag, WebState } from "./atoms";
import { KV, KeyFacts, ScoreReasons, ScreenshotFrame, SocialCard } from "./Evidence";
import { ThreatActionButtons, useCanAct, useSetStatus } from "./useThreatActions";
import { detailWebState, type FindingDetail } from "./types";

const TABS = ["evidence", "infrastructure", "related", "history", "takedown"] as const;
type Tab = (typeof TABS)[number];

const CHANGE_LABELS: Record<string, string> = {
  registrar: "Registrar",
  nameservers: "Nameservers",
  last_changed: "Registration updated",
  expires: "Expiry",
  status: "Registry status",
  ip: "IP",
  site: "Website",
};

function changeValue(field: string, value: string | null): string {
  if (!value) return "—";
  if (field === "last_changed" || field === "expires") return fullDate(value);
  if (field === "site" && value.startsWith("down since ")) return `down since ${fullDate(value.slice(11))}`;
  return value;
}

// One threat: what it is and how bad (header), the decision buttons, and five tabs of detail.
export function ThreatView({ finding }: { finding: FindingDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canAct = useCanAct();
  const setStatusRemote = useSetStatus();
  const [status, setStatus] = useState(finding.status);

  const requested = params.get("tab");
  const isSocial = finding.type === "social";
  const tabs = TABS.filter((t) => !(isSocial && (t === "infrastructure" || t === "takedown")));
  const tab: Tab = tabs.includes(requested as Tab) ? (requested as Tab) : "evidence";

  function selectTab(next: string) {
    const q = new URLSearchParams(params.toString());
    if (next === "evidence") q.delete("tab");
    else q.set("tab", next);
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  const target = describeTarget(finding.identifier, finding.type);
  const label = target.primary;
  const change = (to: string) => setStatusRemote(finding.id, label, status, to, setStatus);
  const di = finding.domainIntel;
  const wi = finding.websiteIntel;
  const onHold = Boolean(di?.statusCodes.some((s) => s === "clientHold" || s === "serverHold"));
  const web = detailWebState(finding);
  const puny = finding.type === "domain" && finding.identifier.startsWith("xn--") ? finding.identifier : null;
  const takedownContacts = [
    di?.registrar && { provider: `${di.registrar} (registrar)`, contact: [di.registrarAbuseEmail, di.registrarAbusePhone].filter(Boolean).join(", ") || null },
    di?.hostingOrg && { provider: `${di.hostingOrg} (hosting)`, contact: di.hostingAbuseEmail },
  ].filter((c): c is { provider: string; contact: string | null } => Boolean(c));

  const actions = canAct && (
    <ThreatActionButtons
      id={finding.id}
      type={finding.type}
      status={status}
      onConfirm={() => change("confirmed")}
      onDismiss={() => change("false_positive")}
      takedownHref={`${pathname}?tab=takedown`}
    />
  );

  return (
    <div className={cn(canAct && "max-lg:pb-16")}>
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-[12.5px] text-subtle">
        <Link href="/threats" className="hover:text-primary">
          Threats
        </Link>
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <Link href={`/threats?status=${status}`} className="hover:text-primary">
          {statusLabel(status)}
        </Link>
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <span className="min-w-0 truncate font-mono text-muted-foreground">{label}</span>
      </nav>

      <Tabs value={tab} onValueChange={selectTab}>
        <section className="mb-4 rounded-md border border-border bg-card px-4 pt-4 lg:sticky lg:top-[calc(52px+env(safe-area-inset-top))] lg:z-20 lg:px-[18px]">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="mb-2 text-[18px] font-medium leading-tight tracking-[-0.02em] lg:text-[22px]">
                <Ident value={label} highlight={!isSocial} />
                {(puny || target.secondary) && <span className="mt-1 block font-mono text-xs font-normal tracking-normal text-subtle">{puny ? `${puny} · punycode` : target.secondary}</span>}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <SeverityTag severity={finding.severity} />
                <ScoreMeter score={finding.riskScore} severity={finding.severity} />
                <StatusPill status={status} />
                <WebState state={web} />
                <TypeTag type={target.platform === "Google Play" || target.platform === "App Store" ? "app" : finding.type} />
                {di?.firstResolvedAt && !di.currentlyResolves && (
                  <Pill tone="investigating">
                    <Unplug className="size-3" />
                    No longer resolves
                  </Pill>
                )}
                {onHold && (
                  <Pill tone="resolved">
                    <ShieldOff className="size-3" />
                    Suspended at registry
                  </Pill>
                )}
                {finding.underTakedownWatch && (
                  <Pill tone="takedown">
                    <Eye className="size-3" />
                    {finding.downSince ? "Down · watching for reactivation" : "Watching for reactivation"}
                  </Pill>
                )}
                <span className="text-xs text-subtle">
                  {sourceLabel(finding.source)} · found <span title={fullDate(finding.firstDetectedAt)}>{timeAgo(finding.firstDetectedAt)}</span> · checked{" "}
                  <span title={fullDate(finding.lastScannedAt)}>{timeAgo(finding.lastScannedAt)}</span>
                </span>
              </div>
            </div>
            {actions && <div className="hidden flex-wrap gap-1.5 lg:flex">{actions}</div>}
          </div>
          <TabsList className="border-b-0">
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            {tabs.includes("infrastructure") && <TabsTrigger value="infrastructure">Infrastructure</TabsTrigger>}
            <TabsTrigger value="related" count={finding.indicators.length || undefined}>
              Related
            </TabsTrigger>
            <TabsTrigger value="history" count={finding.changes.length + finding.evidence.length || undefined}>
              History
            </TabsTrigger>
            {tabs.includes("takedown") && <TabsTrigger value="takedown">Takedown</TabsTrigger>}
          </TabsList>
        </section>

        <TabsContent value="evidence" className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Panel>
              <PanelHeader title={isSocial ? "Social account" : "Screenshot"} />
              <PanelBody>{isSocial ? <SocialCard finding={finding} /> : <ScreenshotFrame finding={finding} />}</PanelBody>
            </Panel>
            <AiExplanationPanel findingId={finding.id} initialExplanation={finding.aiExplanation} />
            {finding.publicReports.length > 0 && (
              <Panel>
                <PanelHeader title="Reported by the public" count={finding.publicReports.length} />
                <ul>
                  {finding.publicReports.map((r) => (
                    <li key={r.id} className={cn("border-b border-border px-3.5 py-2.5 text-[13px] last:border-b-0", r.status === "dismissed" && "opacity-50")}>
                      <div className="text-xs text-subtle">
                        <span title={fullDate(r.createdAt)}>{timeAgo(r.createdAt)}</span> · {r.status}
                        {r.phone && (
                          <>
                            {" "}
                            · number given: <span className="font-mono">{r.phone}</span>
                          </>
                        )}
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{r.description || "(no description)"}</p>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel>
              <PanelHeader title="Why this score" />
              <PanelBody>
                <ScoreReasons finding={finding} />
              </PanelBody>
            </Panel>
            <FindingLifecycle
              findingId={finding.id}
              status={status}
              onStatusChange={(s) => s !== status && change(s)}
              initialAssigneeId={finding.assigneeId}
              initialTags={finding.tags}
              canEdit={canAct}
            />
            {!isSocial && (
              <Panel>
                <PanelHeader title="Key facts" />
                <PanelBody>
                  <KeyFacts finding={finding} />
                </PanelBody>
              </Panel>
            )}
          </div>
        </TabsContent>

        <TabsContent value="infrastructure" className="grid items-start gap-4 xl:grid-cols-2">
          <Panel>
            <PanelHeader title="Registration" action={di?.whoisSource && <span className="text-subtle">{di.whoisSource}</span>} />
            <PanelBody>
              <KV
                rows={[
                  ["Domain", <span key="d" className="font-mono">{finding.type === "domain" ? finding.identifier : (target.primary ?? finding.identifier)}</span>],
                  ["Status", di ? (!di.firstResolvedAt ? "Never confirmed registered" : di.currentlyResolves ? "Active" : `No longer resolves (first confirmed ${new Date(di.firstResolvedAt).toLocaleDateString()})`) : null],
                  ["Registered", di?.registeredAt ? fullDate(di.registeredAt) : null],
                  ["Last changed", di?.lastChangedAt ? fullDate(di.lastChangedAt) : null],
                  ["Expires", di?.expiresAt ? fullDate(di.expiresAt) : null],
                  ["Registrar", di?.registrar],
                  ["Registry status", di?.statusCodes.length ? <span key="s" className="font-mono">{di.statusCodes.join(", ")}</span> : null],
                  ["Nameservers", di?.nameservers.length ? <span key="n" className="font-mono">{di.nameservers.join("\n")}</span> : null],
                ]}
              />
            </PanelBody>
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel>
              <PanelHeader title="Hosting and website" action={!finding.websiteDataCurrent && wi && <span className="text-sev-medium">From an earlier scan</span>} />
              <PanelBody>
                <KV
                  rows={[
                    ["IP", di?.ip ? <span key="ip" className="font-mono">{di.ip}</span> : null],
                    ["Hosting", di?.hostingOrg],
                    ["Page title", wi?.title],
                    ["HTTP status", wi?.httpStatus != null ? String(wi.httpStatus) : null],
                    ["Login form", wi ? (wi.hasLoginForm ? "Yes" : "No") : null],
                    ["Payment form", wi ? (wi.hasPaymentForm ? "Yes" : "No") : null],
                    ["Parked page", wi ? (wi.looksParked ? "Yes" : "No") : null],
                    ["Looks like your site", wi ? (wi.visualSimilarityMatch ? "Yes" : "No") : null],
                  ]}
                />
              </PanelBody>
            </Panel>
            {(di?.registrarAbuseEmail || di?.hostingAbuseEmail || di?.registrarAbusePhone) && (
              <Panel>
                <PanelHeader title="Report abuse to" />
                <PanelBody>
                  <KV
                    rows={[
                      ...(di?.registrarAbuseEmail || di?.registrarAbusePhone
                        ? [["Registrar", <span key="r" className="font-mono select-all">{[di.registrarAbuseEmail, di.registrarAbusePhone].filter(Boolean).join(" · ")}</span>] as [string, React.ReactNode]]
                        : []),
                      ...(di?.hostingAbuseEmail ? [["Host", <span key="h" className="font-mono select-all">{di.hostingAbuseEmail}</span>] as [string, React.ReactNode]] : []),
                    ]}
                  />
                </PanelBody>
              </Panel>
            )}
          </div>
        </TabsContent>

        <TabsContent value="related" className="flex flex-col gap-4">
          <IndicatorsPanel indicators={finding.indicators} />
          <RelatedFindingsPanel findingId={finding.id} />
        </TabsContent>

        <TabsContent value="history" className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
          <Panel>
            <PanelHeader title="Registration and site changes" count={finding.changes.length} />
            <PanelBody>
              {finding.changes.length === 0 ? (
                <p className="text-[13px] text-subtle">No changes since monitoring began.</p>
              ) : (
                <ol className="relative">
                  {finding.changes.map((c) => (
                    <li key={c.id} className="relative pb-4 pl-[22px] text-[13px] before:absolute before:left-1 before:top-1.5 before:size-[7px] before:rounded-full before:bg-border-strong after:absolute after:bottom-0 after:left-[7px] after:top-4 after:w-px after:bg-border last:after:hidden data-[hot=true]:before:bg-sev-critical" data-hot={c.field === "site" || c.field === "nameservers"}>
                      <time className="block font-mono text-[11.5px] text-subtle" title={fullDate(c.detectedAt)}>
                        {timeAgo(c.detectedAt)}
                      </time>
                      {CHANGE_LABELS[c.field] ?? c.field} changed
                      <div className="mt-1 overflow-x-auto rounded-sm border border-border bg-sunk px-2 py-1.5 font-mono text-xs">
                        <div className="text-sev-critical">- {changeValue(c.field, c.oldValue)}</div>
                        <div className="text-ok">+ {changeValue(c.field, c.newValue)}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Evidence recorded across scans" count={finding.evidence.length} />
            <PanelBody>
              {finding.evidence.length === 0 ? (
                <p className="text-[13px] text-subtle">None yet.</p>
              ) : (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-muted-foreground">
                  {finding.evidence.map((e) => (
                    <li key={e.id}>{e.description}</li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        </TabsContent>

        <TabsContent value="takedown" className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {status === "new" || status === "investigating" ? (
            <div className="xl:col-span-2 flex items-start gap-2.5 rounded-md border border-sev-medium/40 bg-sev-medium/8 px-3.5 py-2.5 text-[13px] text-muted-foreground">
              <PauseCircle className="mt-0.5 size-4 shrink-0 text-sev-medium" />
              <span>
                <b className="text-foreground">Not confirmed yet.</b> Automatic takedown reports only go out for confirmed or critical threats. You can still prepare and send one by hand
                below.
              </span>
            </div>
          ) : null}
          <div className="min-w-0">
            <ReportFlow findingId={finding.id} initialOpen={params.get("report")} />
          </div>
          <div className="min-w-0">
            <TakedownLog findingId={finding.id} contacts={takedownContacts} siteLive={web === "live" && finding.websiteDataCurrent} />
          </div>
        </TabsContent>
      </Tabs>

      {actions && (
        <div className="fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-border bg-card py-2.5 pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] lg:hidden [&>*]:min-w-0 [&>*]:flex-1 [&>*]:px-2 [&>*]:text-[12.5px]">
          {actions}
        </div>
      )}
    </div>
  );
}
