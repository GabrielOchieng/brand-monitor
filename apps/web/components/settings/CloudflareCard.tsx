"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { Field } from "./Section";
import { PasswordInput } from "../ui/PasswordInput";

export interface IntegrationView {
  provider: string;
  enabled: boolean;
  publicConfig: { accountId?: string; name?: string; email?: string; company?: string | null; tele?: string | null; hostNotification?: string; ownerNotification?: string };
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

// Settings -> Automatic reporting: Cloudflare's abuse-reports API (step 6). With it connected and
// checked, reports about sites behind Cloudflare are submitted by API instead of being a manual
// web-form task.
export function CloudflareCard({ integration, isOwner, canTest, onChange }: { integration: IntegrationView | null; isOwner: boolean; canTest: boolean; onChange: () => Promise<void> }) {
  const p = integration?.publicConfig ?? {};
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    accountId: p.accountId ?? "",
    apiToken: "",
    name: p.name ?? "",
    email: p.email ?? "",
    company: p.company ?? "",
    tele: p.tele ?? "",
    hostNotification: p.hostNotification ?? "send",
    ownerNotification: p.ownerNotification ?? "send-anon",
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await apiFetch("/api/takedown-automation/integrations/cloudflare", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      setEditing(false);
      setF((x) => ({ ...x, apiToken: "" }));
      await onChange();
      setMsg({ ok: true, text: "Saved. Check the connection to start using it." });
    });
  }

  return (
    <div className="card min-w-0 p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-ink">Cloudflare abuse reports (optional)</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-subtle">
        Many phishing sites sit behind Cloudflare, which normally takes reports through a web form. If your Cloudflare account has the <em>abuse-reports</em> entitlement
        (Enterprise accounts do; others ask Cloudflare), connect it here and those reports are submitted by API. The token needs the <em>Trust and Safety Write</em>{" "}
        permission. Cloudflare may pass the reporter details on to the host and, if you choose, to the site owner.
      </p>

      {integration && !editing && (
        <div className="mt-4 space-y-2 text-sm">
          <div className="text-ink">
            Account <span className="font-mono text-xs">{p.accountId}</span> · reporter {p.name} &lt;{p.email}&gt;
          </div>
          <div className={integration.lastTestOk ? "text-emerald-700" : integration.lastTestOk === false ? "text-red-600" : "text-ink-subtle"}>
            {integration.lastTestAt ? `${integration.lastTestOk ? "Connection works" : "Check failed"}, ${timeAgo(integration.lastTestAt)}` : "Not checked yet: reports keep going to the web form until it is."}
            {integration.lastTestOk === false && integration.lastTestError && <span className="block text-xs">{integration.lastTestError}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {canTest && (
              <button
                className="btn-secondary text-xs"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await apiFetch<{ ok: boolean; error: string | null }>("/api/takedown-automation/integrations/cloudflare/test", { method: "POST" });
                    setMsg(r.ok ? { ok: true, text: "Connection works." } : { ok: false, text: r.error ?? "Check failed." });
                    await onChange();
                  })
                }
              >
                Check connection
              </button>
            )}
            {isOwner && (
              <>
                <button className="btn-ghost text-xs" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button
                  className="btn-ghost text-xs text-red-600"
                  onClick={() =>
                    window.confirm("Disconnect Cloudflare? Reports to Cloudflare go back to its web form.") &&
                    run(async () => {
                      await apiFetch("/api/takedown-automation/integrations/cloudflare", { method: "DELETE" });
                      await onChange();
                    })
                  }
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {(!integration || editing) && isOwner && (
        <form onSubmit={save} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Account ID" hint="32 characters, from the Cloudflare dashboard.">
              <input required className="field w-full font-mono text-xs" value={f.accountId} onChange={set("accountId")} />
            </Field>
            <Field label="API token" hint={integration ? "Stored. Leave blank to keep it." : "Trust and Safety Write permission."}>
              <PasswordInput required={!integration} className="field w-full" value={f.apiToken} onChange={set("apiToken")} autoComplete="new-password" />
            </Field>
            <Field label="Reporter name">
              <input required className="field w-full" value={f.name} onChange={set("name")} />
            </Field>
            <Field label="Reporter email">
              <input type="email" required className="field w-full" value={f.email} onChange={set("email")} />
            </Field>
            <Field label="Company (optional)">
              <input className="field w-full" value={f.company} onChange={set("company")} />
            </Field>
            <Field label="Phone (optional)">
              <input className="field w-full" value={f.tele} onChange={set("tele")} />
            </Field>
            <Field label="Host sees the reporter details">
              <select className="field w-full" value={f.hostNotification} onChange={set("hostNotification")}>
                <option value="send">Yes</option>
                <option value="send-anon">No, anonymously</option>
              </select>
            </Field>
            <Field label="Site owner sees the reporter details">
              <select className="field w-full" value={f.ownerNotification} onChange={set("ownerNotification")}>
                <option value="send-anon">No, anonymously (recommended)</option>
                <option value="send">Yes</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              Save
            </button>
            {integration && (
              <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {!integration && !isOwner && <p className="mt-3 text-sm text-ink-subtle">Not connected. An owner can connect it.</p>}
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
