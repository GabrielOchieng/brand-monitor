"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, FileText, Image as ImageIcon, Mail, MailWarning, RotateCcw, Send, Trash2, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useMyRole } from "../../lib/useMyRole";
import { useSession } from "../../lib/session";
import { cn } from "../../lib/cn";
import { ACTION_STATUS_LABELS, ACTION_STATUS_TONE, CHANNEL_LABELS, DOCUMENT_KIND_LABELS, KIND_LABELS } from "../../lib/autoTakedown";
import { Panel, PanelBody, PanelHeader, SectionTitle } from "../ui/Panel";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Banner";
import { Input, Textarea } from "../ui/Field";
import { useConfirm } from "../ui/Confirm";
import { useToast } from "../ui/Toast";
import { Pill } from "../threat/atoms";

// Not sent yet, so still editable (EDITABLE_STATUSES in the API's lib/takedownPolicy.ts).
const EDITABLE = ["draft", "awaiting_approval", "pending_veto", "queued", "manual", "failed"];
const SENDABLE = ["draft", "awaiting_approval", "pending_veto", "queued", "failed"];
const CANCELLABLE = ["awaiting_approval", "pending_veto", "queued", "manual", "failed", "shadow"];

export interface Routing {
  method: "email" | "form" | "skip" | "none" | "api";
  to: string[];
  forms: Array<{ url: string; instructions: string | null }>;
  why: string;
  removed: Array<{ address: string; reason: "own_domain" | "blocked" }>;
}

export interface Draft {
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

export interface DraftsData {
  websitesOnly: boolean;
  channels: Array<{ channel: string; kinds: string[]; routing: Routing }>;
  redirectTo: string | null;
  replies: Array<{ id: string; actionId: string; kind: string; fromAddress: string; subject: string; snippet: string; ticketRef: string | null; receivedAt: string }>;
  hasScreenshot: boolean;
  documents: Array<{ id: string; kind: string; filename: string }>;
  senderAddress: string | null;
  drafts: Draft[];
}

const list = (s: string): string[] =>
  s
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useCanEditReports(): boolean {
  const role = useMyRole();
  const { me } = useSession();
  return !me?.adminView && (role === "owner" || role === "admin" || role === "analyst");
}

// Where a report goes and why (lib/recipients.ts in the API), in one line plus the details.
export function RoutingSummary({ routing, compact }: { routing: Routing; compact?: boolean }) {
  const head =
    routing.method === "email"
      ? routing.to.join(", ")
      : routing.method === "api"
        ? "Cloudflare's abuse-reports API"
        : routing.method === "form"
          ? `Web form${routing.forms.length > 1 ? "s" : ""}: a manual task`
          : routing.method === "skip"
            ? "Not reported through this channel"
            : "No recipient found";
  return (
    <div className="min-w-0 text-xs text-subtle">
      <div className={cn("truncate", routing.method === "email" && "font-mono", (routing.method === "none" || routing.method === "skip") && "text-sev-medium")}>{head}</div>
      {!compact && (
        <>
          <p className="mt-0.5">{routing.method === "none" ? "Add a recipient to the report, or to the contact book under Settings → Report recipients. " : ""}{routing.why}</p>
          {routing.forms.map((f) => (
            <p key={f.url} className="mt-0.5">
              <a className="font-medium text-primary hover:underline" href={f.url} target="_blank" rel="noreferrer">
                {f.url}
              </a>
              {f.instructions ? ` · ${f.instructions}` : ""}
            </p>
          ))}
          {routing.removed.length > 0 && (
            <p className="mt-0.5">Left out by the safety rules: {routing.removed.map((r) => `${r.address} (${r.reason === "own_domain" ? "your own domain" : "never send to"})`).join(", ")}.</p>
          )}
        </>
      )}
    </div>
  );
}

// The threat page's way to take a site down: pick who to report to, prepare the report from the
// org's templates, review and edit it, then send it from the org's own mailbox
// (TAKEDOWN_AUTOMATION_PLAN.md §5.3). Earlier reports for this threat are listed below.
export function ReportFlow({ findingId, initialOpen }: { findingId: string; initialOpen?: string | null }) {
  const canEdit = useCanEditReports();
  const [data, setData] = useState<DraftsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState("");
  const [kind, setKind] = useState("first");
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch<DraftsData>(`/api/findings/${findingId}/report-drafts`);
      setData(d);
      setChannel((c) => c || (d.channels.find((x) => x.routing.method !== "skip")?.channel ?? d.channels[0]?.channel ?? ""));
    } catch (err) {
      setError(errText(err));
    }
  }, [findingId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) return <Banner tone="error">{error}</Banner>;
  if (!data || data.websitesOnly) return null;

  const chosen = data.channels.find((c) => c.channel === channel);
  const kinds = chosen?.kinds ?? [];

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const d = await apiFetch<Draft>(`/api/findings/${findingId}/report-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, kind: kinds.includes(kind) ? kind : kinds[0] }),
      });
      await load();
      setOpen(d.id);
    } catch (err) {
      setError(errText(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Panel id="report-drafts" className="scroll-mt-28">
      <PanelHeader title="Send a report" action={data.senderAddress && <span className="font-mono text-subtle">from {data.senderAddress}</span>} />
      <PanelBody className="flex flex-col gap-4">
        {data.redirectTo && (
          <Banner tone="warn" title="Test mode is on.">
            Reports are delivered to <span className="font-mono">{data.redirectTo}</span> instead of the real recipients.
          </Banner>
        )}

        {canEdit && data.channels.length > 0 && (
          <div>
            <SectionTitle>Who to report to</SectionTitle>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Who to report to">
              {data.channels.map((c) => (
                <label
                  key={c.channel}
                  className={cn(
                    "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-md border border-border px-3 py-2.5 text-[13px] hover:border-border-strong",
                    channel === c.channel && "border-primary/55 bg-primary-soft hover:border-primary/55"
                  )}
                >
                  <input type="radio" name="report-channel" className="mt-0.5 accent-[var(--primary)]" checked={channel === c.channel} onChange={() => setChannel(c.channel)} />
                  <div className="min-w-0">
                    <div className="font-medium">{CHANNEL_LABELS[c.channel] ?? c.channel}</div>
                    <RoutingSummary routing={c.routing} compact={channel !== c.channel} />
                  </div>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {kinds.length > 1 && (
                <div className="inline-flex overflow-hidden rounded-md border border-border-strong" role="radiogroup" aria-label="Kind of report">
                  {kinds.map((k) => (
                    <label key={k} className={cn("cursor-pointer border-l border-border-strong px-3 py-1.5 text-[12.5px] text-muted-foreground first:border-l-0", (kinds.includes(kind) ? kind : kinds[0]) === k && "bg-primary-soft text-foreground")}>
                      <input type="radio" name="report-kind" className="sr-only" checked={(kinds.includes(kind) ? kind : kinds[0]) === k} onChange={() => setKind(k)} />
                      {KIND_LABELS[k] ?? k}
                    </label>
                  ))}
                </div>
              )}
              <Button variant="primary" onClick={create} disabled={!channel || creating}>
                <FileText />
                {creating ? "Preparing…" : "Prepare report"}
              </Button>
              <span className="text-xs text-subtle">Written from your template with this threat&apos;s evidence. Nothing is sent yet.</span>
            </div>
          </div>
        )}
        {error && <p className="text-[13px] text-sev-critical">{error}</p>}

        <div>
          <SectionTitle>Reports for this threat</SectionTitle>
          {data.drafts.length === 0 ? (
            <p className="text-[13px] text-subtle">None yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.drafts.map((d) => (
                <li key={d.id} className={cn("rounded-md border border-border", open === d.id && "border-border-strong")}>
                  <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-hover" onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}>
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{CHANNEL_LABELS[d.channel] ?? d.channel}</span>
                      <span className="text-muted-foreground"> · {KIND_LABELS[d.kind] ?? d.kind}</span>
                      <span className="ml-2 font-mono text-xs text-subtle">{d.reportRef}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-subtle">
                      <Pill tone={ACTION_STATUS_TONE[d.status]}>{ACTION_STATUS_LABELS[d.status] ?? d.status}</Pill>
                      <span className="max-sm:hidden">{timeAgo(d.updatedAt)}</span>
                    </span>
                  </button>
                  {open === d.id && (
                    <div className="border-t border-border p-3">
                      <DraftEditor draft={d} data={data} canEdit={canEdit} onChanged={load} onDeleted={() => (setOpen(null), load())} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

// Replies and bounces on one report, as a thread.
export function ReplyThread({ draft, replies }: { draft: Draft; replies: DraftsData["replies"] }) {
  const own = replies.filter((r) => r.actionId === draft.id);
  if (!draft.sentAt && own.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {draft.sentAt && (
        <div className="rounded-md border border-l-[3px] border-border border-l-primary bg-background px-3 py-2 text-[13px]">
          <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-subtle">
            <b className="font-medium text-foreground">You → {draft.redirected ? "your test address" : draft.to.join(", ") || CHANNEL_LABELS[draft.channel]}</b>
            <time>{timeAgo(draft.sentAt)}</time>
          </div>
          <div className="truncate">{draft.subject}</div>
        </div>
      )}
      {own.map((r) => (
        <div key={r.id} className={cn("rounded-md border border-l-[3px] border-border bg-background px-3 py-2 text-[13px]", r.kind === "bounce" ? "border-l-sev-critical" : "border-l-sev-medium")}>
          <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-subtle">
            <b className="flex items-center gap-1.5 font-medium text-foreground">
              {r.kind === "bounce" ? <MailWarning className="size-3.5 text-sev-critical" /> : <Mail className="size-3.5" />}
              {r.kind === "bounce" ? "Bounced" : r.fromAddress}
            </b>
            <span>
              {r.ticketRef && <>their ticket <span className="font-mono">{r.ticketRef}</span> · </>}
              <time>{timeAgo(r.receivedAt)}</time>
            </span>
          </div>
          <div className="font-medium">{r.subject}</div>
          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{r.snippet}</p>
        </div>
      ))}
    </div>
  );
}

// One report: where it goes, the conversation so far, the editable text, and what can be done
// with it in its current state.
export function DraftEditor({ draft, data, canEdit, onChanged, onDeleted }: { draft: Draft; data: DraftsData; canEdit: boolean; onChanged: () => Promise<void>; onDeleted: () => void }) {
  const ask = useConfirm();
  const toast = useToast();
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
  const viaApi = draft.routing?.method === "api";

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
    } catch (err) {
      setMessage({ ok: false, text: errText(err) });
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

  const send = () =>
    run("send", async () => {
      const ok = await ask({
        title: viaApi ? "Submit to Cloudflare now?" : "Send this report now?",
        body: viaApi ? "It goes to Cloudflare's abuse-reports API with the attachments." : `From your organization's mailbox to ${list(to).join(", ")}${data.redirectTo ? ` (test mode: delivered to ${data.redirectTo})` : ""}.`,
        confirmLabel: viaApi ? "Submit" : "Send report",
      });
      if (!ok) return;
      if (dirty) await save();
      const r = await apiFetch<{ status: string; detail?: string }>(`/api/takedown-actions/${draft.id}/send`, { method: "POST" });
      if (r.status === "sent") toast(`Sent ${draft.reportRef}`);
      else setMessage({ ok: false, text: `${r.status === "held" ? "On hold" : r.status === "skipped" ? "Not sent" : "Failed"}${r.detail ? `: ${r.detail}` : ""}` });
      await onChanged();
    });

  const markReported = () =>
    run("manual", async () => {
      const reference = await ask({
        title: "Reported it through the web form?",
        body: "This logs the report so the time to takedown is measured.",
        confirmLabel: "Mark as reported",
        input: { label: "Ticket or case number", placeholder: "e.g. VRC-48211", optional: true },
      });
      if (reference === null) return;
      await apiFetch(`/api/takedown-actions/${draft.id}/mark-reported`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: `${CHANNEL_LABELS[draft.channel] ?? draft.channel} (web form)`, reference }),
      });
      toast("Marked as reported");
      await onChanged();
    });

  const cancel = () =>
    run("cancel", async () => {
      if (!(await ask({ title: "Cancel this report?", body: "It won't be made again automatically.", confirmLabel: "Cancel report", cancelLabel: "Keep it", danger: true }))) return;
      await apiFetch(`/api/takedown-actions/${draft.id}/cancel`, { method: "POST" });
      toast(`Cancelled ${draft.reportRef}`);
      await onChanged();
    });

  const test = () =>
    run("test", async () => {
      if (dirty) await save();
      const r = await apiFetch<{ ok: boolean; to: string; error: string | null }>(`/api/report-drafts/${draft.id}/test`, { method: "POST" });
      setMessage(r.ok ? { ok: true, text: `Test sent to ${r.to} only, with the attachments.` } : { ok: false, text: r.error ?? "Sending failed." });
    });

  const rerender = () =>
    run("rerender", async () => {
      const ok = await ask({
        title: "Rewrite from the template?",
        body: "The text is written again from the current template and this threat's latest data. Your edits to the text are lost; recipients and attachments stay.",
        confirmLabel: "Rewrite",
      });
      if (!ok) return;
      const d = await apiFetch<Draft>(`/api/report-drafts/${draft.id}/rerender`, { method: "POST" });
      setSubject(d.subject);
      setBody(d.body);
      await onChanged();
    });

  const remove = () =>
    run("delete", async () => {
      if (!(await ask({ title: "Delete this draft?", confirmLabel: "Delete", danger: true }))) return;
      await apiFetch(`/api/report-drafts/${draft.id}`, { method: "DELETE" });
      onDeleted();
    });

  async function copy() {
    try {
      await navigator.clipboard.writeText(isForm ? body : `Subject: ${subject}\n\n${body}`);
      setMessage({ ok: true, text: "Copied." });
    } catch {
      setMessage({ ok: false, text: "Couldn't copy. Select the text and copy it yourself." });
    }
  }

  const fieldRow = "grid grid-cols-[48px_minmax(0,1fr)] items-center gap-2";
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {draft.error && <div className="rounded-md border border-sev-critical/35 bg-sev-critical/8 px-2.5 py-2 font-mono text-xs text-sev-critical [overflow-wrap:anywhere]">{draft.error}</div>}
      {draft.holdReason && <Banner tone="warn" title="On hold:">{draft.holdReason}</Banner>}
      {draft.skipReason && <Banner tone="info" title="Not sent:">{draft.skipReason}</Banner>}
      {draft.routing && EDITABLE.includes(draft.status) && (
        <div className="rounded-md border border-border bg-raised px-3 py-2">
          <RoutingSummary routing={draft.routing} />
        </div>
      )}
      <ReplyThread draft={draft} replies={data.replies} />

      {!isForm && (
        <div className="flex flex-col gap-2">
          {(
            [
              ["To", to, setTo, "abuse@registrar.example"],
              ["Cc", cc, setCc, ""],
              ["Bcc", bcc, setBcc, ""],
            ] as const
          ).map(([label, value, set, ph]) => (
            <label key={label} className={fieldRow}>
              <span className="text-xs text-subtle">{label}</span>
              <Input mono className="h-8" value={value} disabled={!editable} onChange={(e) => set(e.target.value)} placeholder={ph} />
            </label>
          ))}
          <label className={fieldRow}>
            <span className="text-xs text-subtle">Subject</span>
            <Input className="h-8" value={subject} disabled={!editable} onChange={(e) => setSubject(e.target.value)} />
          </label>
        </div>
      )}
      <Textarea aria-label="Report text" rows={14} mono className="text-xs leading-relaxed" value={body} disabled={!editable} onChange={(e) => setBody(e.target.value)} />

      {!isForm && (data.hasScreenshot || data.documents.length > 0) && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1.5 text-xs text-subtle">Attachments</legend>
          {data.hasScreenshot && (
            <label className="inline-flex items-center gap-2 rounded-sm border border-border px-2 py-1 text-xs">
              <input type="checkbox" className="accent-[var(--primary)]" checked={includeScreenshot} disabled={!editable} onChange={(e) => setIncludeScreenshot(e.target.checked)} />
              <ImageIcon className="size-3.5 text-subtle" />
              Latest screenshot
            </label>
          )}
          {data.documents.map((doc) => (
            <label key={doc.id} className="inline-flex items-center gap-2 rounded-sm border border-border px-2 py-1 text-xs">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={documentIds.includes(doc.id)}
                disabled={!editable}
                onChange={(e) => setDocumentIds((ids) => (e.target.checked ? [...ids, doc.id] : ids.filter((x) => x !== doc.id)))}
              />
              <FileText className="size-3.5 text-subtle" />
              <span className="font-mono">{doc.filename}</span>
              <span className="text-subtle">{DOCUMENT_KIND_LABELS[doc.kind] ?? doc.kind}</span>
            </label>
          ))}
        </fieldset>
      )}

      {message && <p className={cn("text-xs", message.ok ? "text-ok" : "text-sev-critical")}>{message.text}</p>}
      <div className="flex flex-wrap gap-1.5">
        {canEdit && !isForm && SENDABLE.includes(draft.status) && (
          <Button variant="primary" size="sm" disabled={!!busy || (list(to).length === 0 && !viaApi)} onClick={send}>
            <Send />
            {busy === "send" ? "Sending…" : draft.status === "failed" ? "Retry sending" : draft.status === "awaiting_approval" ? "Approve and send" : "Send"}
          </Button>
        )}
        {canEdit && draft.status === "manual" && (
          <Button variant="primary" size="sm" disabled={!!busy} onClick={markReported}>
            Mark as reported
          </Button>
        )}
        {editable && (
          <Button size="sm" disabled={!!busy || !dirty} onClick={() => run("save", async () => (await save(), setMessage({ ok: true, text: "Saved." })))}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
        )}
        {canEdit && !isForm && (
          <Button size="sm" variant="ghost" disabled={!!busy} title={dirty ? "Saves your changes first" : undefined} onClick={test}>
            <Mail />
            {busy === "test" ? "Sending…" : "Send test to me"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={copy}>
          <Copy />
          Copy text
        </Button>
        {editable && (
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={rerender}>
            <RotateCcw />
            Rewrite from template
          </Button>
        )}
        {canEdit && CANCELLABLE.includes(draft.status) && (
          <Button size="sm" variant="danger" disabled={!!busy} onClick={cancel}>
            <X />
            Cancel report
          </Button>
        )}
        {canEdit && draft.status === "draft" && (
          <Button size="sm" variant="danger" disabled={!!busy} onClick={remove}>
            <Trash2 />
            Delete
          </Button>
        )}
      </div>
      <p className="text-xs text-subtle">
        {draft.templateSource === "default" ? "Written from the built-in text" : "Written from your published template"}
        {draft.edited ? ", then edited by hand" : ""}. Last saved by {draft.updatedBy}.{draft.lastTestAt ? ` Tested ${timeAgo(draft.lastTestAt)}.` : ""}
        {draft.sentAt ? ` Sent ${timeAgo(draft.sentAt)}${draft.redirected ? " (test mode)" : ""}.` : ""}
      </p>
    </div>
  );
}
