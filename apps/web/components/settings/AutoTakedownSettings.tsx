"use client";

import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Check, Clock } from "lucide-react";
import { cn } from "../../lib/cn";
import { Banner } from "../ui/Banner";
import { Button, buttonVariants } from "../ui/Button";
import { Switch, ToggleRow } from "../ui/Switch";
import { useConfirm } from "../ui/Confirm";
import { useToast } from "../ui/Toast";
import { API_URL, apiFetch } from "../../lib/api";
import { useSession, type Role } from "../../lib/session";
import { fullDate, timeAgo } from "../../lib/format";
import { authorizationStatus, BLOCKER_LABELS, DOCUMENT_KIND_LABELS, EVENT_LABELS, formatBytes, PROVIDER_LABELS } from "../../lib/autoTakedown";
import { CheckIcon } from "../icons";
import { LoadingRegion, Skeleton } from "../Skeleton";
import { Field, Card, SettingsHead, Toggle } from "./Section";
import type { SendingData } from "./AutoTakedownSending";
import type { IntegrationView } from "./CloudflareCard";
import { PasswordInput } from "../ui/PasswordInput";

type Provider = "graph" | "gmail" | "smtp";

interface Sender {
  provider: Provider;
  fromAddress: string;
  fromName: string | null;
  replyTo: string | null;
  bccArchive: string | null;
  signature: string | null;
  publicConfig: Record<string, string | number>;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestTo: string | null;
  updatedAt: string;
  updatedBy: string | null;
  readReplies: boolean;
  repliesCheckedAt: string | null;
  repliesError: string | null;
}

interface Doc {
  id: string;
  kind: string;
  filename: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

interface Authorization {
  id: string;
  brandId: string | null;
  signatoryName: string;
  signatoryTitle: string;
  signatoryEmail: string;
  signatoryPhone: string | null;
  scope: string | null;
  validFrom: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
  createdBy: string;
  documents: Doc[];
}

export interface Overview extends Omit<SendingData, "automation"> {
  integrations: IntegrationView[];
  platformEnabled: boolean;
  encryptionConfigured: boolean;
  allowedAt: string | null;
  allowedBy: string | null;
  automation: (NonNullable<SendingData["automation"]> & { enabledBy: string | null; stoppedAt: string | null; stoppedBy: string | null; stopReason: string | null }) | null;
  sender: Sender | null;
  authorizations: Authorization[];
  brands: Array<{ id: string; name: string; primaryDomain: string; autoTakedownEnabled: boolean; blockers: string[] }>;
  blockers: string[];
  events: Array<{ id: string; actorEmail: string | null; action: string; details: Record<string, unknown> | null; createdAt: string }>;
}


const AutomationContext = createContext<{ data: Overview | null; error: string | null; setError: (e: string | null) => void; reload: () => Promise<void> } | null>(null);

// Loads the automatic-reporting overview once for every page under Settings -> Automatic reporting.
export function AutomationProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await apiFetch<Overview>("/api/takedown-automation"));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return <AutomationContext.Provider value={{ data, error, setError, reload }}>{children}</AutomationContext.Provider>;
}

export function useAutomation(): { data: Overview | null; error: string | null; setError: (e: string | null) => void; reload: () => Promise<void> } {
  const v = useContext(AutomationContext);
  if (!v) throw new Error("useAutomation must be used inside <AutomationProvider>");
  return v;
}

export function AutomationLoading() {
  const { error } = useAutomation();
  return <LoadingRegion label="Loading automatic reporting settings">{error ? <p className="text-sm text-sev-critical">{error}</p> : <Skeleton className="h-40 w-full" />}</LoadingRegion>;
}

type Step = { key: string; title: string; text: ReactNode; state: "done" | "todo" | "warn" | "wait" | "optional"; href?: string; action?: string };

// What's left before reports go out on their own, worked out from the same blockers the
// dispatcher checks (lib/takedownAutomation.ts automationBlockers).
function setupSteps(data: Overview): Step[] {
  const b = new Set(data.blockers);
  const stage = data.automation?.stage ?? "shadow";
  const cloudflare = data.integrations.find((i) => i.provider === "cloudflare");
  const inForce = data.authorizations.filter((a) => authorizationStatus(a) === "in_force");
  return [
    {
      key: "sender",
      title: "Sender mailbox",
      state: b.has("no_sender") ? "todo" : b.has("sender_untested") ? "warn" : "done",
      text: !data.sender ? (
        "Connect the mailbox reports are sent from (Microsoft 365, Gmail or SMTP)."
      ) : (
        <>
          <span className="font-mono">{data.sender.fromAddress}</span> · {PROVIDER_LABELS[data.sender.provider] ?? data.sender.provider}.{" "}
          {b.has("sender_untested") ? "Send a test with its current settings." : data.sender.lastTestAt ? `Tested ${timeAgo(data.sender.lastTestAt)}.` : ""}
        </>
      ),
      href: "/settings/automatic-reporting/sender",
      action: b.has("no_sender") ? "Connect" : b.has("sender_untested") ? "Test" : "Manage",
    },
    {
      key: "authorization",
      title: "Authorization",
      state: b.has("no_authorization") ? "todo" : "done",
      text: inForce.length
        ? `${inForce.length} in force. ${inForce[0].signatoryName}, ${inForce[0].signatoryTitle}${inForce[0].expiresAt ? `, until ${new Date(inForce[0].expiresAt).toLocaleDateString()}` : ""}.`
        : "Record who authorizes reports on your behalf, and attach the signed letter.",
      href: "/settings/automatic-reporting/authorization",
      action: b.has("no_authorization") ? "Add" : "View",
    },
    {
      key: "rules",
      title: "Sending rules and test mode",
      state: stage === "live" ? "done" : "warn",
      text:
        stage === "shadow"
          ? "Test mode: reports are prepared and recorded, never sent. Review them under Takedowns → Test mode, then move on."
          : stage === "redirect"
            ? `Test mode: reports are sent, but to ${data.automation?.redirectTo ?? "your test address"} instead of the real recipients.`
            : "Live: reports go to their real recipients.",
      href: "/settings/automatic-reporting/sending",
      action: "Review",
    },
    {
      key: "allowed",
      title: "Approval from the platform team",
      state: b.has("not_allowed") ? "wait" : "done",
      text: data.allowedAt ? `Allowed ${timeAgo(data.allowedAt)}.` : "Brand Monitor checks every organization's authorization before its first automatic report.",
    },
    {
      key: "enabled",
      title: "Turned on by an owner",
      state: b.has("not_enabled") ? "todo" : "done",
      text: data.automation?.enabledAt ? `On since ${timeAgo(data.automation.enabledAt)}${data.automation.enabledBy ? ` (${data.automation.enabledBy})` : ""}.` : "The last switch, once everything above is done.",
    },
    {
      key: "cloudflare",
      title: "Cloudflare",
      state: cloudflare?.enabled && cloudflare.lastTestOk ? "done" : "optional",
      text: cloudflare?.enabled ? (cloudflare.lastTestOk ? "Connected: reports about Cloudflare sites go through its API." : "Saved, but the connection hasn't passed a check yet.") : "Reports about sites behind Cloudflare skip its web form. Usually the fastest takedown.",
      href: "/settings/automatic-reporting/cloudflare",
      action: cloudflare ? "Manage" : "Connect",
    },
  ];
}

const STEP_ICON: Record<Step["state"], { cls: string; icon: ReactNode }> = {
  done: { cls: "bg-ok/15 text-ok border-transparent", icon: <Check className="size-3.5" strokeWidth={2.6} /> },
  warn: { cls: "bg-sev-medium/15 text-sev-medium border-transparent", icon: <span className="text-xs font-bold">!</span> },
  todo: { cls: "border-dashed border-border-strong text-muted-foreground", icon: <span className="size-1.5 rounded-full bg-current" /> },
  wait: { cls: "border-dashed border-border-strong text-muted-foreground", icon: <Clock className="size-3.5" /> },
  optional: { cls: "border-border-strong text-subtle", icon: <span className="size-1.5 rounded-full bg-current" /> },
};

// Settings -> Automatic reporting: a checklist of what's left, the switches, and Stop all.
export function AutomationSetup({ role }: { role: Role | null }) {
  const { data, error, setError, reload } = useAutomation();
  const ask = useConfirm();
  const toast = useToast();
  const isOwner = role === "owner";
  const canManage = role === "owner" || role === "admin";
  const canStop = canManage || role === "analyst";

  async function act(path: string, body?: unknown) {
    setError(null);
    try {
      await apiFetch(path, { method: "POST", ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      await reload();
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  }

  if (!data) return <AutomationLoading />;

  const enabled = !!data.automation?.enabledAt;
  const stopped = !!data.automation?.stoppedAt;
  const setupMissing = data.blockers.filter((b) => ["not_allowed", "no_sender", "sender_untested", "no_authorization"].includes(b));
  const live = data.blockers.length === 0;
  const steps = setupSteps(data);
  const required = steps.filter((s) => s.state !== "optional");
  const done = required.filter((s) => s.state === "done").length;

  return (
    <section className="flex flex-col gap-4">
      <SettingsHead
        title="Automatic takedown reporting"
        description={
          <>
            Abuse reports for lookalike <strong className="text-foreground">websites</strong>, sent from your own mailbox to registrars, hosts and CERTs. Social media accounts
            are always reported by hand. Until every step below is done, reports are prepared and wait for approval under Takedowns.
          </>
        }
      />
      {error && <Banner tone="error">{error}</Banner>}
      {data.blockers.includes("platform_disabled") && (
        <Banner tone="info" title="Switched off on this server.">
          Automatic sending is disabled for the whole Brand Monitor installation, so nothing is sent whatever the settings here say.
        </Banner>
      )}
      {stopped ? (
        <Banner tone="error" title="All sending is stopped.">
          Stopped {timeAgo(data.automation!.stoppedAt!)}
          {data.automation!.stoppedBy ? ` by ${data.automation!.stoppedBy}` : ""}
          {data.automation!.stopReason ? `: ${data.automation!.stopReason}` : ""}. Only an owner can resume.
        </Banner>
      ) : live ? (
        <Banner tone="ok" title="Sending automatically.">
          Reports for qualifying threats go out on their own, within your sending rules.
        </Banner>
      ) : (
        <Banner tone="warn" title={`Not sending yet: ${required.length - done} step${required.length - done === 1 ? "" : "s"} left.`}>
          <span className="mt-2 flex items-center gap-2.5">
            <span className="h-1.5 w-full max-w-60 overflow-hidden rounded-full bg-border-strong">
              <span className="block h-full bg-primary" style={{ width: `${(done / required.length) * 100}%` }} />
            </span>
            <span className="whitespace-nowrap font-mono text-xs text-subtle">
              {done} of {required.length}
            </span>
          </span>
        </Banner>
      )}

      <ul className="overflow-hidden rounded-md border border-border bg-card">
        {steps.map((s) => (
          <li key={s.key} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3 border-b border-border p-3.5 last:border-b-0 sm:grid-cols-[28px_minmax(0,1fr)_auto]">
            <span className={cn("grid size-6 place-items-center rounded-full border", STEP_ICON[s.state].cls)} aria-label={s.state}>
              {STEP_ICON[s.state].icon}
            </span>
            <div className="min-w-0">
              <h4 className="mb-0.5 flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
                {s.title}
                {s.state === "optional" && <span className="rounded-sm border border-border-strong px-1.5 text-[10.5px] font-medium text-subtle">Optional</span>}
                {s.state === "wait" && <span className="rounded-sm border border-border-strong px-1.5 text-[10.5px] font-medium text-subtle">Waiting</span>}
              </h4>
              <p className="text-[12.5px] text-muted-foreground">{s.text}</p>
            </div>
            {s.href && (
              <Link href={s.href} className={cn(buttonVariants({ variant: s.state === "todo" || s.state === "warn" ? "secondary" : "ghost", size: "sm" }), "col-start-2 justify-self-start sm:col-start-auto")}>
                {s.action}
              </Link>
            )}
          </li>
        ))}
      </ul>

      <Card title="Switches" description={isOwner ? undefined : "Only an owner can turn automatic reporting on or off."}>
        <ToggleRow label="Automatic reporting for the organization" hint={setupMissing.length ? "Available once the setup steps above are done." : enabled ? "On" : "Off"}>
          <Switch
            checked={enabled}
            disabled={!isOwner || (!enabled && setupMissing.length > 0)}
            aria-label="Automatic reporting for the organization"
            onCheckedChange={async (next) => {
              if (!next && !(await ask({ title: "Turn automatic reporting off?", body: "Reports go back to being sent by hand.", confirmLabel: "Turn off" }))) return;
              if (await act(next ? "/api/takedown-automation/enable" : "/api/takedown-automation/disable")) toast(next ? "Automatic reporting is on" : "Automatic reporting is off");
            }}
          />
        </ToggleRow>
        {data.brands.map((b) => (
          <ToggleRow
            key={b.id}
            label={b.name}
            hint={b.blockers.length === 0 ? "Ready" : b.blockers.includes("brand_off") ? "Off: this brand's reports stay manual" : b.blockers.includes("no_authorization") ? "No authorization covers this brand" : "Waiting on the organization's setup"}
          >
            <Switch
              checked={b.autoTakedownEnabled}
              disabled={!canManage}
              aria-label={`Automatic reporting for ${b.name}`}
              onCheckedChange={async (next) => {
                setError(null);
                try {
                  await apiFetch(`/api/takedown-automation/brands/${b.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
                  await reload();
                } catch (err: any) {
                  setError(err.message);
                }
              }}
            />
          </ToggleRow>
        ))}
      </Card>

      {(canStop || (isOwner && stopped)) && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-sev-critical/35 bg-card p-4">
          <div>
            <b className="text-[13.5px] text-sev-critical">{stopped ? "Sending is stopped" : "Stop all sending"}</b>
            <p className="mt-0.5 text-xs text-subtle">
              {stopped ? "Resuming lets qualifying reports go out again." : "Stops every automatic report for every brand at once, effective immediately. Use it if something looks wrong."}
            </p>
          </div>
          {!stopped && canStop && (
            <Button
              variant="danger"
              onClick={async () => {
                const reason = await ask({
                  title: "Stop all automatic sending?",
                  body: "Nothing is sent automatically for any brand until an owner resumes it.",
                  confirmLabel: "Stop all sending",
                  danger: true,
                  input: { label: "Why (shown to your team)", placeholder: "e.g. wrong recipient on registrar reports", optional: true },
                });
                if (reason !== null && (await act("/api/takedown-automation/stop", { reason }))) toast("All automatic sending stopped");
              }}
            >
              Stop all sending
            </Button>
          )}
          {stopped && isOwner && (
            <Button
              onClick={async () => {
                if (await ask({ title: "Resume sending?", body: "Reports that qualify will be sent again.", confirmLabel: "Resume" })) await act("/api/takedown-automation/resume");
              }}
            >
              Resume sending
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export function AutomationHistory() {
  const { data } = useAutomation();
  if (!data) return <AutomationLoading />;
  return (
    <section className="flex flex-col gap-4">
      <SettingsHead title="History" description="Every change to the automatic-reporting settings and every test send." />
      <div className="rounded-md border border-border bg-card">
        {data.events.length === 0 ? (
          <p className="p-4 text-[13px] text-subtle">Nothing yet.</p>
        ) : (
          <ul>
            {data.events.map((e) => (
              <li key={e.id} className="grid grid-cols-[90px_1fr] gap-3 border-b border-border px-4 py-2.5 text-[13px] last:border-b-0">
                <time className="font-mono text-[11.5px] text-subtle" title={fullDate(e.createdAt)}>
                  {timeAgo(e.createdAt)}
                </time>
                <span>
                  {EVENT_LABELS[e.action] ?? e.action}
                  {e.action === "sender.test" && e.details && (
                    <span className={e.details.ok ? "text-ok" : "text-sev-critical"}>
                      {" "}
                      {e.details.ok ? "delivered" : "failed"} ({String(e.details.to)})
                    </span>
                  )}
                  {e.action === "document.upload" && e.details && <span className="text-subtle"> {String(e.details.filename)}</span>}
                  <span className="text-subtle"> · {e.actorEmail ?? "someone"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// --- Sender mailbox ---------------------------------------------------------------------------

const PROVIDER_HELP: Record<Provider, ReactNode> = {
  graph: (
    <>
      Your IT team registers an app in Microsoft Entra with the <code>Mail.Send</code> <em>application</em> permission (admin consent), and limits it to this one mailbox
      with <em>RBAC for Applications</em> in Exchange Online. Then enter the tenant ID, the app&apos;s client ID and a client secret. Mail goes out through your
      Microsoft 365, so it passes your SPF/DKIM/DMARC.
    </>
  ),
  gmail: (
    <>
      Your Google Workspace admin creates a service account in Google Cloud, turns on the Gmail API, and grants the service account domain-wide delegation for the
      scope <code>https://www.googleapis.com/auth/gmail.send</code>. Paste the service account&apos;s JSON key. Sends count against the mailbox&apos;s Gmail limit
      (about 2,000 a day).
    </>
  ),
  smtp: (
    <>
      Your own mail server. It must be reachable on the internet and support TLS (port 465, or STARTTLS on 587/25/2525). Microsoft 365 is turning off password sign-in
      for SMTP, so use the Microsoft 365 option for it instead.
    </>
  ),
};

export function SenderCard({ data, isOwner, canTest, onChange }: { data: Overview; isOwner: boolean; canTest: boolean; onChange: () => Promise<void> }) {
  const ask = useConfirm();
  const { me } = useSession();
  const s = data.sender;
  const [editing, setEditing] = useState(!s);
  const [provider, setProvider] = useState<Provider>(s?.provider ?? "graph");
  const [form, setForm] = useState({
    fromAddress: s?.fromAddress ?? "",
    fromName: s?.fromName ?? "",
    replyTo: s?.replyTo ?? "",
    bccArchive: s?.bccArchive ?? "",
    signature: s?.signature ?? "",
    tenantId: String(s?.publicConfig.tenantId ?? ""),
    clientId: String(s?.publicConfig.clientId ?? ""),
    clientSecret: "",
    serviceAccountKey: "",
    host: String(s?.publicConfig.host ?? ""),
    port: String(s?.publicConfig.port ?? "587"),
    username: String(s?.publicConfig.username ?? ""),
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState(me?.user.email ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error: string | null } | null>(null);
  const [dns, setDns] = useState<{ domain: string; spf: string | null; dmarc: string | null; dmarcPolicy: string | null } | null>(null);

  const keepsSecret = s?.provider === provider;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const config =
      provider === "graph"
        ? { provider, tenantId: form.tenantId, clientId: form.clientId, ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}) }
        : provider === "gmail"
          ? { provider, ...(form.serviceAccountKey ? { serviceAccountKey: form.serviceAccountKey } : {}) }
          : { provider, host: form.host, port: Number(form.port), username: form.username, ...(form.password ? { password: form.password } : {}) };
    try {
      await apiFetch("/api/takedown-automation/sender", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromAddress: form.fromAddress, fromName: form.fromName, replyTo: form.replyTo, bccArchive: form.bccArchive, signature: form.signature, config }),
      });
      setForm((f) => ({ ...f, clientSecret: "", serviceAccountKey: "", password: "" }));
      setEditing(false);
      setTestResult(null);
      await onChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      setTestResult(
        await apiFetch<{ ok: boolean; error: string | null }>("/api/takedown-automation/sender/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: testTo }),
        })
      );
      await onChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  }

  async function checkDns() {
    setError(null);
    try {
      setDns(await apiFetch("/api/takedown-automation/sender/dns"));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!(await ask({ title: "Remove the sender mailbox?", body: "Its stored credentials are deleted, and automatic reporting stops until a mailbox is connected and tested again.", confirmLabel: "Remove mailbox", danger: true }))) return;
    try {
      await apiFetch("/api/takedown-automation/sender", { method: "DELETE" });
      setEditing(true);
      await onChange();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Card
      title="Sender mailbox"
      description="Reports are sent from your organization's own mailbox (for example brandprotection@yourcompany.com), never from Brand Monitor's, so registrars see your domain and replies come back to you."
    >
      {!data.encryptionConfigured && <p className="mb-3 text-sm text-sev-critical">The server has no AUTH_ENCRYPTION_KEY, so sender credentials can&apos;t be stored.</p>}

      {s && !editing && (
        <div className="space-y-3 text-sm">
          <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-subtle">Sends with</dt>
            <dd className="text-foreground">{PROVIDER_LABELS[s.provider]}</dd>
            <dt className="text-subtle">From</dt>
            <dd className="break-all text-foreground">{s.fromName ? `${s.fromName} <${s.fromAddress}>` : s.fromAddress}</dd>
            {s.replyTo && (
              <>
                <dt className="text-subtle">Replies to</dt>
                <dd className="break-all text-foreground">{s.replyTo}</dd>
              </>
            )}
            {s.bccArchive && (
              <>
                <dt className="text-subtle">Archive copy (BCC)</dt>
                <dd className="break-all text-foreground">{s.bccArchive}</dd>
              </>
            )}
            {Object.entries(s.publicConfig).map(([k, v]) => (
              <span key={k} className="contents">
                <dt className="text-subtle">{{ tenantId: "Tenant ID", clientId: "Client ID", serviceAccount: "Service account", host: "Host", port: "Port", username: "Username" }[k] ?? k}</dt>
                <dd className="break-all text-foreground">{String(v)}</dd>
              </span>
            ))}
            <dt className="text-subtle">Last test</dt>
            <dd className={s.lastTestOk ? "text-ok" : s.lastTestOk === false ? "text-sev-critical" : "text-subtle"}>
              {s.lastTestAt ? `${s.lastTestOk ? "Delivered" : "Failed"} to ${s.lastTestTo}, ${timeAgo(s.lastTestAt)}` : "Not tested since the last change"}
              {s.lastTestOk === false && s.lastTestError && <span className="mt-0.5 block text-xs">{s.lastTestError}</span>}
            </dd>
          </dl>
          {s.signature && <pre className="whitespace-pre-wrap rounded-md border border-border bg-raised/60 p-3 font-sans text-xs text-muted-foreground">{s.signature}</pre>}

          {canTest && (
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <Field label="Send a test to" hint="A real email from the sender mailbox. Passing it marks the sender as working.">
                <input type="email" className="field w-72 max-w-full" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              </Field>
              <button className="btn-secondary mb-5" disabled={testing || !testTo} onClick={test}>
                {testing ? "Sending…" : "Send test"}
              </button>
            </div>
          )}
          {testResult && (
            <p className={`text-sm ${testResult.ok ? "text-ok" : "text-sev-critical"}`}>
              {testResult.ok ? (
                <>
                  <CheckIcon className="mr-1 inline h-4 w-4" />
                  Sent. Check that it arrived (and not in spam).
                </>
              ) : (
                testResult.error
              )}
            </p>
          )}

          <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
            <div className="min-w-0 text-sm">
              <div className="text-foreground">Read replies and bounces</div>
              <p className="mt-0.5 text-xs leading-relaxed text-subtle">
                {s.provider === "smtp"
                  ? "Not available for SMTP senders: log replies by hand on the finding."
                  : s.provider === "graph"
                    ? "Matches replies to reports by their [BM-…] tag, marks takedowns acknowledged and stops reporting to addresses that bounce. Needs the Mail.Read application permission too, limited to the same mailbox."
                    : "Matches replies to reports by their [BM-…] tag, marks takedowns acknowledged and stops reporting to addresses that bounce. Needs the gmail.readonly scope in the domain-wide delegation too."}
              </p>
              {s.readReplies && (
                <p className={`mt-1 text-xs ${s.repliesError ? "text-sev-critical" : "text-subtle"}`}>
                  {s.repliesError ? `Last check failed: ${s.repliesError}` : s.repliesCheckedAt ? `Last checked ${timeAgo(s.repliesCheckedAt)}.` : "Not checked yet (every 10 minutes)."}
                </p>
              )}
            </div>
            <Toggle
              checked={s.readReplies}
              disabled={!isOwner || s.provider === "smtp"}
              label="Read replies and bounces"
              onChange={async (next) => {
                setError(null);
                try {
                  await apiFetch("/api/takedown-automation/sender/read-replies", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
                  await onChange();
                } catch (err: any) {
                  setError(err.message);
                }
              }}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost text-xs" onClick={checkDns}>
              Check SPF and DMARC
            </button>
            {isOwner && (
              <>
                <button className="btn-ghost text-xs" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button className="btn-ghost text-xs text-sev-critical" onClick={remove}>
                  Remove
                </button>
              </>
            )}
          </div>
          {dns && (
            <div className="rounded-md border border-border p-3 text-xs">
              <div className="text-subtle">SPF for {dns.domain}</div>
              <div className="break-all font-mono text-foreground">{dns.spf ?? "none found"}</div>
              <div className="mt-2 text-subtle">DMARC</div>
              <div className="break-all font-mono text-foreground">{dns.dmarc ?? "none found"}</div>
              <p className="mt-2 text-muted-foreground">
                {!dns.spf || !dns.dmarc
                  ? "Without SPF and DMARC, abuse desks are more likely to treat reports as spam. Ask your IT team to publish them."
                  : "Records found. Mail sent through your own provider passes them when DKIM is set up for the domain."}
              </p>
            </div>
          )}
        </div>
      )}

      {(!s || editing) && isOwner && (
        <form onSubmit={save} className="space-y-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Mail provider">
            {(["graph", "gmail", "smtp"] as Provider[]).map((p) => (
              <button type="button" key={p} role="radio" aria-checked={provider === p} onClick={() => setProvider(p)} className={provider === p ? "btn-primary" : "btn-secondary"}>
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-subtle">{PROVIDER_HELP[provider]}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From address" hint="The mailbox reports are sent from.">
              <input type="email" required className="field w-full" value={form.fromAddress} onChange={set("fromAddress")} placeholder="brandprotection@yourcompany.com" />
            </Field>
            <Field label="From name (optional)">
              <input className="field w-full" value={form.fromName} onChange={set("fromName")} placeholder="Yourcompany Brand Protection" />
            </Field>
            <Field label="Reply-to (optional)" hint="Where registrars' replies go, e.g. a ticketing address.">
              <input type="email" className="field w-full" value={form.replyTo} onChange={set("replyTo")} />
            </Field>
            <Field label="Archive copy, BCC (optional)" hint="Gets a copy of every report sent.">
              <input type="email" className="field w-full" value={form.bccArchive} onChange={set("bccArchive")} />
            </Field>
          </div>

          {provider === "graph" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tenant ID">
                <input required className="field w-full font-mono" value={form.tenantId} onChange={set("tenantId")} placeholder="00000000-0000-0000-0000-000000000000" />
              </Field>
              <Field label="Client (application) ID">
                <input required className="field w-full font-mono" value={form.clientId} onChange={set("clientId")} />
              </Field>
              <Field label="Client secret" hint={keepsSecret ? "Stored. Leave blank to keep it." : undefined}>
                <PasswordInput required={!keepsSecret} className="field w-full" value={form.clientSecret} onChange={set("clientSecret")} autoComplete="new-password" />
              </Field>
            </div>
          )}
          {provider === "gmail" && (
            <Field label="Service account JSON key" hint={keepsSecret ? "Stored. Leave blank to keep it." : "The whole contents of the .json key file."}>
              <textarea required={!keepsSecret} rows={4} className="field w-full font-mono text-xs" value={form.serviceAccountKey} onChange={set("serviceAccountKey")} spellCheck={false} />
            </Field>
          )}
          {provider === "smtp" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Host">
                <input required className="field w-full" value={form.host} onChange={set("host")} placeholder="mail.yourcompany.com" />
              </Field>
              <Field label="Port">
                <select className="field w-full" value={form.port} onChange={set("port")}>
                  {["587", "465", "25", "2525"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Username">
                <input required className="field w-full" value={form.username} onChange={set("username")} autoComplete="off" />
              </Field>
              <Field label="Password" hint={keepsSecret ? "Stored. Leave blank to keep it." : undefined}>
                <PasswordInput required={!keepsSecret} className="field w-full" value={form.password} onChange={set("password")} autoComplete="new-password" />
              </Field>
            </div>
          )}

          <Field label="Signature" hint="Ends every report: name, team, company, phone. Who authorizes the reports is added from the authorization below.">
            <textarea rows={4} className="field w-full" value={form.signature} onChange={set("signature")} />
          </Field>

          {error && <p className="text-sm text-sev-critical">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving || !data.encryptionConfigured}>
              {saving ? "Saving…" : "Save sender"}
            </button>
            {s && (
              <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-subtle">Saving clears the last test: send a new test afterwards.</p>
        </form>
      )}
      {!s && !isOwner && <p className="text-sm text-subtle">No sender mailbox yet. An owner sets it up.</p>}
      {error && !editing && <p className="mt-3 text-sm text-sev-critical">{error}</p>}
    </Card>
  );
}

// --- Authorization ------------------------------------------------------------------------------

export function AuthorizationCard({ data, isOwner, onChange }: { data: Overview; isOwner: boolean; onChange: () => Promise<void> }) {
  const ask = useConfirm();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ brandId: "", signatoryName: "", signatoryTitle: "", signatoryEmail: "", signatoryPhone: "", scope: "", validFrom: "", expiresAt: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const brandName = (id: string | null) => (id ? (data.brands.find((b) => b.id === id)?.name ?? "a deleted brand") : "All brands");

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch("/api/takedown-automation/authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: form.brandId || null,
          signatoryName: form.signatoryName,
          signatoryTitle: form.signatoryTitle,
          signatoryEmail: form.signatoryEmail,
          signatoryPhone: form.signatoryPhone,
          scope: form.scope,
          ...(form.validFrom ? { validFrom: new Date(form.validFrom).toISOString() } : {}),
          expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
        }),
      });
      setAdding(false);
      setForm({ brandId: "", signatoryName: "", signatoryTitle: "", signatoryEmail: "", signatoryPhone: "", scope: "", validFrom: "", expiresAt: "" });
      await onChange();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function upload(authorizationId: string, kind: string, file: File) {
    setError(null);
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Upload a PDF, PNG or JPEG file of at most 5 MB.");
      return;
    }
    setBusy(authorizationId);
    try {
      await apiFetch(`/api/takedown-automation/authorizations/${authorizationId}/documents?kind=${kind}&filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      await onChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function call(path: string, method: string, confirmText: string) {
    if (!(await ask({ title: confirmText, confirmLabel: "Continue", danger: true }))) return;
    setError(null);
    try {
      await apiFetch(path, { method });
      await onChange();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Card
      title="Authorization"
      description="Who authorizes abuse reports in your organization's name. Registrars and hosts often ask for a signed letter of authorization from the rights owner, and sometimes a trademark registration: upload them here so they can be attached to reports. A record can't be edited: revoke it and add a new one."
    >
      {data.authorizations.length === 0 && <p className="text-sm text-subtle">None recorded yet.</p>}
      <ul className="space-y-3">
        {data.authorizations.map((a) => {
          const status = authorizationStatus(a);
          return (
            <li key={a.id} className={`rounded-md border p-3 ${status === "in_force" ? "border-border" : "border-border bg-raised/50 opacity-80"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <div className="font-medium text-foreground">
                    {a.signatoryName}, {a.signatoryTitle}
                  </div>
                  <div className="break-all text-xs text-subtle">
                    {a.signatoryEmail}
                    {a.signatoryPhone ? ` · ${a.signatoryPhone}` : ""}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {brandName(a.brandId)} · from {new Date(a.validFrom).toLocaleDateString()}
                    {a.expiresAt ? ` to ${new Date(a.expiresAt).toLocaleDateString()}` : ", no end date"}
                  </div>
                  {a.scope && <div className="mt-1 text-xs text-muted-foreground">{a.scope}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      status === "in_force" ? "border-ok/40 bg-ok/10 text-ok" : "border-border bg-raised text-subtle"
                    }`}
                  >
                    {{ in_force: "In force", revoked: "Revoked", expired: "Expired", not_started: "Not started" }[status]}
                  </span>
                  {isOwner && !a.revokedAt && (
                    <button className="btn-ghost text-xs text-sev-critical" onClick={() => call(`/api/takedown-automation/authorizations/${a.id}/revoke`, "POST", `Revoke ${a.signatoryName}'s authorization? It can't be undone.`)}>
                      Revoke
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {a.documents.length === 0 && <p className="text-xs text-subtle">No documents uploaded.</p>}
                {a.documents.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-x-2 text-xs">
                    <a className="text-primary hover:underline" href={`${API_URL}/api/takedown-automation/documents/${d.id}`}>
                      {d.filename}
                    </a>
                    <span className="text-subtle">
                      {DOCUMENT_KIND_LABELS[d.kind] ?? d.kind} · {formatBytes(d.sizeBytes)} · {d.uploadedBy}, {timeAgo(d.createdAt)}
                    </span>
                    {isOwner && (
                      <button className="text-sev-critical hover:underline" onClick={() => call(`/api/takedown-automation/documents/${d.id}`, "DELETE", `Delete ${d.filename}?`)}>
                        delete
                      </button>
                    )}
                  </div>
                ))}
                {isOwner && !a.revokedAt && <UploadDocument busy={busy === a.id} onUpload={(kind, file) => upload(a.id, kind, file)} />}
              </div>
            </li>
          );
        })}
      </ul>

      {isOwner && !adding && (
        <button className="btn-secondary mt-4" onClick={() => setAdding(true)}>
          Add an authorization
        </button>
      )}
      {isOwner && adding && (
        <form onSubmit={create} className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Signatory name">
              <input required className="field w-full" value={form.signatoryName} onChange={set("signatoryName")} />
            </Field>
            <Field label="Title" hint="e.g. Head of Legal, CISO">
              <input required className="field w-full" value={form.signatoryTitle} onChange={set("signatoryTitle")} />
            </Field>
            <Field label="Email">
              <input type="email" required className="field w-full" value={form.signatoryEmail} onChange={set("signatoryEmail")} />
            </Field>
            <Field label="Phone (optional)">
              <input className="field w-full" value={form.signatoryPhone} onChange={set("signatoryPhone")} />
            </Field>
            <Field label="Covers">
              <select className="field w-full" value={form.brandId} onChange={set("brandId")}>
                <option value="">All brands</option>
                {data.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From (optional)">
                <input type="date" className="field w-full" value={form.validFrom} onChange={set("validFrom")} />
              </Field>
              <Field label="Until (optional)" hint="Sending stops after this date.">
                <input type="date" className="field w-full" value={form.expiresAt} onChange={set("expiresAt")} />
              </Field>
            </div>
          </div>
          <Field label="Scope (optional)" hint="What it covers, e.g. the trademarks and domains named in the letter.">
            <textarea rows={2} className="field w-full" value={form.scope} onChange={set("scope")} />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">
              Save authorization
            </button>
            <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-sev-critical">{error}</p>}
    </Card>
  );
}

function UploadDocument({ busy, onUpload }: { busy: boolean; onUpload: (kind: string, file: File) => void }) {
  const [kind, setKind] = useState("loa");
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <select className="field-sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Document type">
        {Object.entries(DOCUMENT_KIND_LABELS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      <label className={`btn-ghost cursor-pointer text-xs ${busy ? "opacity-50" : ""}`}>
        {busy ? "Uploading…" : "Upload PDF, PNG or JPEG (max 5 MB)"}
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onUpload(kind, f);
          }}
        />
      </label>
    </div>
  );
}
