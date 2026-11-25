"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useMyRole } from "../lib/useMyRole";
import { ACTION_STATUS_LABELS, ACTION_STATUS_TONE, CHANNEL_LABELS, DOCUMENT_KIND_LABELS, KIND_LABELS } from "../lib/autoTakedown";

// Not sent yet, so still editable (EDITABLE_STATUSES in the API's lib/takedownPolicy.ts).
const EDITABLE = ["draft", "awaiting_approval", "pending_veto", "queued", "manual", "failed"];
const SENDABLE = ["draft", "awaiting_approval", "pending_veto", "queued", "failed"];
const CANCELLABLE = ["awaiting_approval", "pending_veto", "queued", "manual", "failed", "shadow"];

interface Draft {
  id: string;
  channel: string;
  kind: string;
  status: string;
  reportRef: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  includeScreenshot: boolean;
  documentIds: string[];
  templateSource: string;
  edited: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  lastTestAt: string | null;
  routing: Routing | null;
  sentAt: string | null;
  redirected: boolean;
  holdReason: string | null;
  skipReason: string | null;
  error: string | null;
}

interface Routing {
  method: "email" | "form" | "skip" | "none" | "api";
  to: string[];
  forms: Array<{ url: string; instructions: string | null }>;
  why: string;
  removed: Array<{ address: string; reason: "own_domain" | "blocked" }>;
}

// Where a report goes and why (lib/recipients.ts in the API).
function RoutingNote({ routing }: { routing: Routing }) {
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${routing.method === "email" ? "border-line bg-elevated/50 text-ink-muted" : "border-sev-medium/40 bg-sev-medium/10 text-sev-medium"}`}>
      <p>
        {routing.method === "email" && <>Goes to {routing.to.join(", ")}. </>}
        {routing.method === "api" && <>Submitted through Cloudflare&apos;s abuse-reports API, not by email. </>}
        {routing.method === "form" && <>Web form{routing.forms.length > 1 ? "s" : ""} only, so a manual task: send it yourself through the form{routing.forms.length > 1 ? "s" : ""} below. </>}
        {routing.method === "skip" && <>Not reported through this channel. </>}
        {routing.method === "none" && <>No recipient: add one to the draft, or to the contact book under Settings → Report recipients. </>}
        {routing.why}
      </p>
      {routing.forms.map((f) => (
        <p key={f.url} className="mt-1">
          <a className="font-medium text-brand hover:underline" href={f.url} target="_blank" rel="noreferrer">
            {f.url}
          </a>
          {f.instructions ? ` · ${f.instructions}` : ""}
        </p>
      ))}
      {routing.removed.length > 0 && (
        <p className="mt-1">
          Left out by the safety rules: {routing.removed.map((r) => `${r.address} (${r.reason === "own_domain" ? "your own domain" : "never send to"})`).join(", ")}.
        </p>
      )}
    </div>
  );
}

interface DraftsData {
  websitesOnly: boolean;
  channels: Array<{ channel: string; kinds: string[]; routing: Routing }>;
  redirectTo: string | null;
  replies: Array<{ id: string; actionId: string; kind: string; fromAddress: string; subject: string; snippet: string; ticketRef: string | null; receivedAt: string }>;
  hasScreenshot: boolean;
  documents: Array<{ id: string; kind: string; filename: string }>;
  senderAddress: string | null;
  drafts: Draft[];
}

const list = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

// Finding page: report drafts rendered from the org's templates (TAKEDOWN_AUTOMATION_PLAN.md §5.3).
// Analysts edit and save them, and test them on themselves. Sending to the recipient comes later.
export function ReportDrafts({ findingId }: { findingId: string }) {
  const role = useMyRole();
  const canEdit = role === "owner" || role === "admin" || role === "analyst";
  const [data, setData] = useState<DraftsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<DraftsData>(`/api/findings/${findingId}/report-drafts`);
      setData(d);
      setChoice((c) => c || (d.channels[0] ? `${d.channels[0].channel}.first` : ""));
    } catch (err: any) {
      setError(err.message);
    }
  }, [findingId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data || data.websitesOnly) return null;

  async function create() {
    const [channel, kind] = choice.split(".");
    setError(null);
    try {
      const d = await apiFetch<Draft>(`/api/findings/${findingId}/report-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, kind }),
      });
      await load();
      setOpen(d.id);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <section id="report-drafts" className="card scroll-mt-20 p-5">
      <h2 className="label">Takedown reports</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
        Reports written from your report templates with this finding&apos;s evidence, by you or automatically. Edit them until they&apos;re sent, test them on yourself,
        and send them from your organization&apos;s mailbox once automatic reporting is set up (Settings → Automatic reporting).
      </p>

      {canEdit && data.channels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <select className="field-sm" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Report to prepare">
            {data.channels.flatMap((c) =>
              c.kinds.map((k) => (
                <option key={`${c.channel}.${k}`} value={`${c.channel}.${k}`}>
                  {CHANNEL_LABELS[c.channel] ?? c.channel}: {KIND_LABELS[k] ?? k}
                </option>
              ))
            )}
          </select>
          <button className="btn-secondary text-xs" onClick={create} disabled={!choice}>
            Prepare report
          </button>
        </div>
      )}
      {canEdit && choice && (() => {
        const c = data.channels.find((x) => x.channel === choice.split(".")[0]);
        return c ? <div className="mt-2"><RoutingNote routing={c.routing} /></div> : null;
      })()}
      {data.redirectTo && (
        <p className="mt-2 rounded-md border border-sev-medium/40 bg-sev-medium/10 px-3 py-2 text-xs text-sev-medium">
          Redirect mode is on: when reports are sent, they are delivered to {data.redirectTo} instead of the recipients below.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-sev-critical">{error}</p>}

      <ul className="mt-3 space-y-2">
        {data.drafts.map((d) => (
          <li key={d.id} className="rounded-md border border-line">
            <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}>
              <span className="min-w-0 truncate">
                <span className="font-medium text-ink">{CHANNEL_LABELS[d.channel] ?? d.channel}</span>
                <span className="text-ink-muted"> · {KIND_LABELS[d.kind] ?? d.kind}</span>
                <span className="ml-2 font-mono text-xs text-ink-subtle">{d.reportRef}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-ink-subtle">
                <span className={`rounded-full border px-2 py-0.5 ${ACTION_STATUS_TONE[d.status] ?? ""}`}>{ACTION_STATUS_LABELS[d.status] ?? d.status}</span>
                {d.edited ? "edited · " : ""}
                {timeAgo(d.updatedAt)}
              </span>
            </button>
            {open === d.id && <DraftEditor draft={d} data={data} canEdit={canEdit} onChanged={load} onDeleted={() => (setOpen(null), load())} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DraftEditor({ draft, data, canEdit, onChanged, onDeleted }: { draft: Draft; data: DraftsData; canEdit: boolean; onChanged: () => Promise<void>; onDeleted: () => void }) {
  const [to, setTo] = useState(draft.to.join(", "));
  const [cc, setCc] = useState(draft.cc.join(", "));
  const [bcc, setBcc] = useState(draft.bcc.join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [includeScreenshot, setIncludeScreenshot] = useState(draft.includeScreenshot);
  const [documentIds, setDocumentIds] = useState<string[]>(draft.documentIds);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const isForm = draft.channel === "blocklist";
  const editable = canEdit && EDITABLE.includes(draft.status);

  const dirty =
    to !== draft.to.join(", ") ||
    cc !== draft.cc.join(", ") ||
    bcc !== draft.bcc.join(", ") ||
    subject !== draft.subject ||
    body !== draft.body ||
    includeScreenshot !== draft.includeScreenshot ||
    documentIds.join() !== draft.documentIds.join();

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setMessage(null);
    try {
      await fn();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    await apiFetch(`/api/report-drafts/${draft.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: list(to), cc: list(cc), bcc: list(bcc), subject, body, includeScreenshot, documentIds }),
    });
    await onChanged();
  }

  return (
    <div className="space-y-3 border-t border-line px-3 py-3 text-sm">
      {draft.routing && <RoutingNote routing={draft.routing} />}
      {data.replies.filter((r) => r.actionId === draft.id).map((r) => (
        <div key={r.id} className={`rounded-md border px-3 py-2 text-xs ${r.kind === "bounce" ? "border-sev-critical/40 bg-sev-critical/10 text-sev-critical" : "border-ok/40 bg-ok/10 text-ok"}`}>
          <div className="font-medium">
            {r.kind === "bounce" ? "Bounced" : `Reply from ${r.fromAddress}`} · {timeAgo(r.receivedAt)}
            {r.ticketRef ? ` · their ticket ${r.ticketRef}` : ""}
          </div>
          <div className="mt-0.5">{r.subject}</div>
          <p className="mt-1 whitespace-pre-wrap text-[11px] opacity-90">{r.snippet}</p>
        </div>
      ))}
      {!isForm && (
        <div className="grid gap-2">
          {(
            [
              ["To", to, setTo],
              ["Cc", cc, setCc],
              ["Bcc", bcc, setBcc],
            ] as const
          ).map(([label, value, set]) => (
            <label key={label} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs text-ink-subtle">{label}</span>
              <input className="field-sm min-w-0 flex-1" value={value} disabled={!editable} onChange={(e) => set(e.target.value)} placeholder={label === "To" ? "abuse@registrar.example" : ""} />
            </label>
          ))}
          {data.senderAddress && <p className="text-xs text-ink-subtle">From {data.senderAddress}.</p>}
          <label className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-xs text-ink-subtle">Subj.</span>
            <input className="field-sm min-w-0 flex-1 font-mono text-xs" value={subject} disabled={!editable} onChange={(e) => setSubject(e.target.value)} />
          </label>
        </div>
      )}
      <textarea rows={16} className="field w-full font-mono text-xs leading-relaxed" value={body} disabled={!editable} onChange={(e) => setBody(e.target.value)} />

      {!isForm && (data.hasScreenshot || data.documents.length > 0) && (
        <fieldset className="space-y-1">
          <legend className="text-xs text-ink-subtle">Attachments</legend>
          {data.hasScreenshot && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={includeScreenshot} disabled={!editable} onChange={(e) => setIncludeScreenshot(e.target.checked)} />
              Latest screenshot
            </label>
          )}
          {data.documents.map((doc) => (
            <label key={doc.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={documentIds.includes(doc.id)}
                disabled={!editable}
                onChange={(e) => setDocumentIds((ids) => (e.target.checked ? [...ids, doc.id] : ids.filter((x) => x !== doc.id)))}
              />
              {doc.filename} <span className="text-ink-subtle">({DOCUMENT_KIND_LABELS[doc.kind] ?? doc.kind})</span>
            </label>
          ))}
        </fieldset>
      )}

      {message && <p className={`text-xs ${message.ok ? "text-ok" : "text-sev-critical"}`}>{message.text}</p>}
      <div className="flex flex-wrap gap-2">
        {editable && (
          <button className="btn-secondary text-xs" disabled={!!busy || !dirty} onClick={() => run("save", async () => (await save(), setMessage({ ok: true, text: "Saved." })))}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        )}
        {canEdit && !isForm && SENDABLE.includes(draft.status) && (
          <button
            className="btn-primary text-xs"
            disabled={!!busy || (list(to).length === 0 && draft.routing?.method !== "api")}
            onClick={() =>
              run("send", async () => {
                if (!window.confirm(draft.routing?.method === "api" ? "Submit this report to Cloudflare's abuse API now?" : `Send this report from your organization's mailbox to ${list(to).join(", ")} now?`)) return;
                if (dirty) await save();
                const r = await apiFetch<{ status: string; detail?: string }>(`/api/takedown-actions/${draft.id}/send`, { method: "POST" });
                setMessage(r.status === "sent" ? { ok: true, text: "Sent." } : { ok: false, text: `${r.status === "held" ? "On hold" : r.status === "skipped" ? "Not sent" : "Failed"}${r.detail ? `: ${r.detail}` : ""}` });
                await onChanged();
              })
            }
          >
            {busy === "send" ? "Sending…" : draft.status === "failed" ? "Retry sending" : "Send"}
          </button>
        )}
        {canEdit && draft.status === "manual" && (
          <button
            className="btn-primary text-xs"
            disabled={!!busy}
            onClick={() =>
              run("manual", async () => {
                const reference = window.prompt("Reported it through the web form? Ticket or case number, if you got one (optional):");
                if (reference === null) return;
                await apiFetch(`/api/takedown-actions/${draft.id}/mark-reported`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ provider: `${CHANNEL_LABELS[draft.channel] ?? draft.channel} (web form)`, reference }),
                });
                await onChanged();
              })
            }
          >
            Mark as reported
          </button>
        )}
        {canEdit && CANCELLABLE.includes(draft.status) && (
          <button
            className="btn-ghost text-xs text-sev-critical"
            disabled={!!busy}
            onClick={() =>
              run("cancel", async () => {
                if (!window.confirm("Cancel this report? It won't be made again automatically.")) return;
                await apiFetch(`/api/takedown-actions/${draft.id}/cancel`, { method: "POST" });
                await onChanged();
              })
            }
          >
            Cancel report
          </button>
        )}
        {canEdit && !isForm && (
          <button
            className="btn-ghost text-xs"
            disabled={!!busy}
            title={dirty ? "Saves your changes first" : undefined}
            onClick={() =>
              run("test", async () => {
                if (dirty) await save();
                const r = await apiFetch<{ ok: boolean; to: string; error: string | null }>(`/api/report-drafts/${draft.id}/test`, { method: "POST" });
                setMessage(r.ok ? { ok: true, text: `Test sent to ${r.to} only, with the attachments.` } : { ok: false, text: r.error ?? "Sending failed." });
              })
            }
          >
            {busy === "test" ? "Sending…" : "Send test to me"}
          </button>
        )}
        <button
          className="btn-ghost text-xs"
          onClick={() => {
            navigator.clipboard?.writeText(isForm ? body : `Subject: ${subject}\n\n${body}`);
            setMessage({ ok: true, text: "Copied." });
          }}
        >
          Copy text
        </button>
        {editable && (
          <button
            className="btn-ghost text-xs"
            disabled={!!busy}
            onClick={() =>
              run("rerender", async () => {
                if (!window.confirm("Write the text again from the current template and this finding's latest data? Your edits to the text are lost; recipients and attachments stay.")) return;
                const d = await apiFetch<Draft>(`/api/report-drafts/${draft.id}/rerender`, { method: "POST" });
                setSubject(d.subject);
                setBody(d.body);
                await onChanged();
              })
            }
          >
            Rewrite from template
          </button>
        )}
        {canEdit && draft.status === "draft" && (
          <button
            className="btn-ghost text-xs text-sev-critical"
            disabled={!!busy}
            onClick={() =>
              run("delete", async () => {
                if (!window.confirm("Delete this draft?")) return;
                await apiFetch(`/api/report-drafts/${draft.id}`, { method: "DELETE" });
                onDeleted();
              })
            }
          >
            Delete
          </button>
        )}
      </div>
      <p className="text-xs text-ink-subtle">
        {draft.templateSource === "default" ? "Written from the built-in text" : "Written from your published template"}
        {draft.edited ? ", then edited by hand" : ""}. Last saved by {draft.updatedBy}.{draft.lastTestAt ? ` Tested ${timeAgo(draft.lastTestAt)}.` : ""}
        {draft.sentAt ? ` Sent ${timeAgo(draft.sentAt)}${draft.redirected ? " (redirect mode)" : ""}.` : ""}
        {draft.holdReason ? ` On hold: ${draft.holdReason}.` : ""}
        {draft.skipReason ? ` Not sent: ${draft.skipReason}` : ""}
        {draft.error ? ` Error: ${draft.error}` : ""}
      </p>
    </div>
  );
}
