"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { API_URL, apiFetch } from "../../lib/api";
import { useSession, type Role } from "../../lib/session";
import { fullDate, timeAgo } from "../../lib/format";
import { authorizationStatus, BLOCKER_LABELS, DOCUMENT_KIND_LABELS, EVENT_LABELS, formatBytes, PROVIDER_LABELS } from "../../lib/autoTakedown";
import { CheckIcon } from "../icons";
import { LoadingRegion, Skeleton } from "../Skeleton";
import { Field, Toggle } from "./Section";
import { AutoTakedownSending, type SendingData } from "./AutoTakedownSending";
import { CloudflareCard, type IntegrationView } from "./CloudflareCard";

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

interface Overview extends Omit<SendingData, "automation"> {
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

function Card({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="card min-w-0 p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <div className="mt-1 text-sm leading-relaxed text-ink-subtle">{description}</div>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

// Settings -> Takedowns -> Automatic reporting. Step 1 of TAKEDOWN_AUTOMATION_PLAN.md: the
// switches, the sender mailbox and the authorization. Nothing is sent automatically yet.
export function AutoTakedownSettings({ role }: { role: Role | null }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = role === "owner";
  const canManage = role === "owner" || role === "admin";
  const canStop = canManage || role === "analyst";

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<Overview>("/api/takedown-automation"));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path: string, body?: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    try {
      await apiFetch(path, {
        method: "POST",
        ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!data) {
    return (
      <LoadingRegion label="Loading automatic reporting settings">
        {error ? <p className="text-sm text-red-600">{error}</p> : <Skeleton className="h-40 w-full" />}
      </LoadingRegion>
    );
  }

  const enabled = !!data.automation?.enabledAt;
  const stopped = !!data.automation?.stoppedAt;
  const setupMissing = data.blockers.filter((b) => ["not_allowed", "no_sender", "sender_untested", "no_authorization"].includes(b));
  const live = data.blockers.length === 0;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">Automatic reporting</h2>
        <div className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-subtle">
          Abuse reports for lookalike <strong>websites</strong> sent from your own mailbox, to registrars, hosts and CERTs. Social media accounts are always reported by
          hand. Every switch below must be on before anything is sent.
        </div>
        <p className="mt-3 max-w-2xl rounded-md border border-line bg-elevated/60 px-3 py-2 text-xs text-ink-muted">
          Order of setup: sender mailbox and authorization here, wording under Report templates, recipients under Report recipients, then the platform admin allows
          it and an owner turns it on. It starts in shadow mode: nothing is sent until you move it to redirect and then live.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Status and switches */}
      <Card title="Status">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              stopped ? "border-red-200 bg-red-50 text-red-700" : live ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-elevated text-ink-subtle"
            }`}
          >
            {stopped ? "Stopped" : live ? "Ready to send" : enabled ? "On, but blocked" : "Off"}
          </span>
          {data.allowedAt && <span className="text-xs text-ink-subtle">Allowed by the platform admin {timeAgo(data.allowedAt)}</span>}
        </div>
        {data.blockers.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-ink-muted">
            {data.blockers.map((b) => (
              <li key={b} className="flex gap-2">
                <span className="text-ink-subtle">•</span>
                {BLOCKER_LABELS[b] ?? b}
              </li>
            ))}
          </ul>
        )}
        {stopped && (
          <p className="mt-3 text-sm text-red-700">
            Stopped {timeAgo(data.automation!.stoppedAt!)}
            {data.automation!.stoppedBy ? ` by ${data.automation!.stoppedBy}` : ""}
            {data.automation!.stopReason ? `: ${data.automation!.stopReason}` : ""}. Only an owner can resume.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {isOwner &&
            (enabled ? (
              <button className="btn-secondary" onClick={() => act("/api/takedown-automation/disable", undefined, "Turn automatic reporting off? Reports go back to being sent by hand.")}>
                Turn off
              </button>
            ) : (
              <button className="btn-primary" disabled={setupMissing.length > 0} title={setupMissing.length ? "Finish the setup first" : undefined} onClick={() => act("/api/takedown-automation/enable")}>
                Turn on
              </button>
            ))}
          {canStop && !stopped && (
            <button
              className="btn-danger"
              onClick={() => {
                const reason = window.prompt("Stop all automatic sending for the whole organization now? Optionally say why:");
                if (reason !== null) act("/api/takedown-automation/stop", { reason });
              }}
            >
              Stop all sending
            </button>
          )}
          {isOwner && stopped && (
            <button className="btn-secondary" onClick={() => act("/api/takedown-automation/resume", undefined, "Resume sending? Reports that qualify will be sent again.")}>
              Resume sending
            </button>
          )}
        </div>
      </Card>

      <AutoTakedownSending data={data} role={role} onChange={load} onError={setError} />

      <SenderCard data={data} isOwner={isOwner} canTest={canManage} onChange={load} />
      <AuthorizationCard data={data} isOwner={isOwner} onChange={load} />
      <CloudflareCard integration={data.integrations.find((i) => i.provider === "cloudflare") ?? null} isOwner={isOwner} canTest={canManage} onChange={load} />

      {data.brands.length > 0 && (
        <Card title="Brands" description="Turn automatic reporting off for a brand to keep its reports manual.">
          <ul className="divide-y divide-line">
            {data.brands.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{b.name}</div>
                  <div className="truncate text-xs text-ink-subtle">
                    {b.blockers.length === 0 ? "Ready" : b.blockers.includes("brand_off") ? "Off for this brand" : b.blockers.includes("no_authorization") ? "No authorization covers this brand" : "Blocked by the organization settings"}
                  </div>
                </div>
                <Toggle
                  checked={b.autoTakedownEnabled}
                  disabled={!canManage}
                  label={`Automatic reporting for ${b.name}`}
                  onChange={async (next) => {
                    setError(null);
                    try {
                      await apiFetch(`/api/takedown-automation/brands/${b.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
                      await load();
                    } catch (err: any) {
                      setError(err.message);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="History" description="Every change to these settings and every test send.">
        {data.events.length === 0 ? (
          <p className="text-sm text-ink-subtle">Nothing yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="text-ink">{EVENT_LABELS[e.action] ?? e.action}</span>
                {e.action === "sender.test" && e.details && (
                  <span className={e.details.ok ? "text-emerald-700" : "text-red-600"}>
                    {e.details.ok ? "delivered" : "failed"} ({String(e.details.to)})
                  </span>
                )}
                {e.action === "document.upload" && e.details && <span className="text-ink-subtle">{String(e.details.filename)}</span>}
                <span className="text-ink-subtle">
                  {e.actorEmail ?? "someone"} · <span title={fullDate(e.createdAt)}>{timeAgo(e.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
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

function SenderCard({ data, isOwner, canTest, onChange }: { data: Overview; isOwner: boolean; canTest: boolean; onChange: () => Promise<void> }) {
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
    if (!window.confirm("Remove the sender mailbox? Its stored credentials are deleted.")) return;
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
      {!data.encryptionConfigured && <p className="mb-3 text-sm text-red-600">The server has no AUTH_ENCRYPTION_KEY, so sender credentials can&apos;t be stored.</p>}

      {s && !editing && (
        <div className="space-y-3 text-sm">
          <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-ink-subtle">Sends with</dt>
            <dd className="text-ink">{PROVIDER_LABELS[s.provider]}</dd>
            <dt className="text-ink-subtle">From</dt>
            <dd className="break-all text-ink">{s.fromName ? `${s.fromName} <${s.fromAddress}>` : s.fromAddress}</dd>
            {s.replyTo && (
              <>
                <dt className="text-ink-subtle">Replies to</dt>
                <dd className="break-all text-ink">{s.replyTo}</dd>
              </>
            )}
            {s.bccArchive && (
              <>
                <dt className="text-ink-subtle">Archive copy (BCC)</dt>
                <dd className="break-all text-ink">{s.bccArchive}</dd>
              </>
            )}
            {Object.entries(s.publicConfig).map(([k, v]) => (
              <span key={k} className="contents">
                <dt className="text-ink-subtle">{{ tenantId: "Tenant ID", clientId: "Client ID", serviceAccount: "Service account", host: "Host", port: "Port", username: "Username" }[k] ?? k}</dt>
                <dd className="break-all text-ink">{String(v)}</dd>
              </span>
            ))}
            <dt className="text-ink-subtle">Last test</dt>
            <dd className={s.lastTestOk ? "text-emerald-700" : s.lastTestOk === false ? "text-red-600" : "text-ink-subtle"}>
              {s.lastTestAt ? `${s.lastTestOk ? "Delivered" : "Failed"} to ${s.lastTestTo}, ${timeAgo(s.lastTestAt)}` : "Not tested since the last change"}
              {s.lastTestOk === false && s.lastTestError && <span className="mt-0.5 block text-xs">{s.lastTestError}</span>}
            </dd>
          </dl>
          {s.signature && <pre className="whitespace-pre-wrap rounded-md border border-line bg-elevated/60 p-3 font-sans text-xs text-ink-muted">{s.signature}</pre>}

          {canTest && (
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <Field label="Send a test to" hint="A real email from the sender mailbox. Passing it marks the sender as working.">
                <input type="email" className="field w-72 max-w-full" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              </Field>
              <button className="btn-secondary mb-5" disabled={testing || !testTo} onClick={test}>
                {testing ? "Sending…" : "Send test"}
              </button>
            </div>
          )}
          {testResult && (
            <p className={`text-sm ${testResult.ok ? "text-emerald-700" : "text-red-600"}`}>
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

          <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-3">
            <div className="min-w-0 text-sm">
              <div className="text-ink">Read replies and bounces</div>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">
                {s.provider === "smtp"
                  ? "Not available for SMTP senders: log replies by hand on the finding."
                  : s.provider === "graph"
                    ? "Matches replies to reports by their [BM-…] tag, marks takedowns acknowledged and stops reporting to addresses that bounce. Needs the Mail.Read application permission too, limited to the same mailbox."
                    : "Matches replies to reports by their [BM-…] tag, marks takedowns acknowledged and stops reporting to addresses that bounce. Needs the gmail.readonly scope in the domain-wide delegation too."}
              </p>
              {s.readReplies && (
                <p className={`mt-1 text-xs ${s.repliesError ? "text-red-600" : "text-ink-subtle"}`}>
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
                <button className="btn-ghost text-xs text-red-600" onClick={remove}>
                  Remove
                </button>
              </>
            )}
          </div>
          {dns && (
            <div className="rounded-md border border-line p-3 text-xs">
              <div className="text-ink-subtle">SPF for {dns.domain}</div>
              <div className="break-all font-mono text-ink">{dns.spf ?? "none found"}</div>
              <div className="mt-2 text-ink-subtle">DMARC</div>
              <div className="break-all font-mono text-ink">{dns.dmarc ?? "none found"}</div>
              <p className="mt-2 text-ink-muted">
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
          <p className="text-xs leading-relaxed text-ink-subtle">{PROVIDER_HELP[provider]}</p>

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
                <input type="password" required={!keepsSecret} className="field w-full" value={form.clientSecret} onChange={set("clientSecret")} autoComplete="new-password" />
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
                <input type="password" required={!keepsSecret} className="field w-full" value={form.password} onChange={set("password")} autoComplete="new-password" />
              </Field>
            </div>
          )}

          <Field label="Signature" hint="Ends every report: name, team, company, phone. Who authorizes the reports is added from the authorization below.">
            <textarea rows={4} className="field w-full" value={form.signature} onChange={set("signature")} />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}
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
          <p className="text-xs text-ink-subtle">Saving clears the last test: send a new test afterwards.</p>
        </form>
      )}
      {!s && !isOwner && <p className="text-sm text-ink-subtle">No sender mailbox yet. An owner sets it up.</p>}
      {error && !editing && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Card>
  );
}

// --- Authorization ------------------------------------------------------------------------------

function AuthorizationCard({ data, isOwner, onChange }: { data: Overview; isOwner: boolean; onChange: () => Promise<void> }) {
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
    if (!window.confirm(confirmText)) return;
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
      {data.authorizations.length === 0 && <p className="text-sm text-ink-subtle">None recorded yet.</p>}
      <ul className="space-y-3">
        {data.authorizations.map((a) => {
          const status = authorizationStatus(a);
          return (
            <li key={a.id} className={`rounded-md border p-3 ${status === "in_force" ? "border-line" : "border-line bg-elevated/50 opacity-80"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <div className="font-medium text-ink">
                    {a.signatoryName}, {a.signatoryTitle}
                  </div>
                  <div className="break-all text-xs text-ink-subtle">
                    {a.signatoryEmail}
                    {a.signatoryPhone ? ` · ${a.signatoryPhone}` : ""}
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {brandName(a.brandId)} · from {new Date(a.validFrom).toLocaleDateString()}
                    {a.expiresAt ? ` to ${new Date(a.expiresAt).toLocaleDateString()}` : ", no end date"}
                  </div>
                  {a.scope && <div className="mt-1 text-xs text-ink-muted">{a.scope}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      status === "in_force" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-line bg-elevated text-ink-subtle"
                    }`}
                  >
                    {{ in_force: "In force", revoked: "Revoked", expired: "Expired", not_started: "Not started" }[status]}
                  </span>
                  {isOwner && !a.revokedAt && (
                    <button className="btn-ghost text-xs text-red-600" onClick={() => call(`/api/takedown-automation/authorizations/${a.id}/revoke`, "POST", `Revoke ${a.signatoryName}'s authorization? It can't be undone.`)}>
                      Revoke
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {a.documents.length === 0 && <p className="text-xs text-ink-subtle">No documents uploaded.</p>}
                {a.documents.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-x-2 text-xs">
                    <a className="text-brand hover:underline" href={`${API_URL}/api/takedown-automation/documents/${d.id}`}>
                      {d.filename}
                    </a>
                    <span className="text-ink-subtle">
                      {DOCUMENT_KIND_LABELS[d.kind] ?? d.kind} · {formatBytes(d.sizeBytes)} · {d.uploadedBy}, {timeAgo(d.createdAt)}
                    </span>
                    {isOwner && (
                      <button className="text-red-600 hover:underline" onClick={() => call(`/api/takedown-automation/documents/${d.id}`, "DELETE", `Delete ${d.filename}?`)}>
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
        <form onSubmit={create} className="mt-4 space-y-3 border-t border-line pt-4">
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
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
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
