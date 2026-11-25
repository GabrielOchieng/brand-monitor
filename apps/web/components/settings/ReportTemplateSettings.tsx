"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { CHANNEL_LABELS, KIND_LABELS, LANGUAGE_LABELS } from "../../lib/autoTakedown";
import type { Role } from "../../lib/session";
import { Skeleton } from "../Skeleton";
import { useConfirmText } from "../ui/Confirm";
import { Field } from "./Section";

interface Version {
  id: string;
  version: number;
  status: "draft" | "published" | "archived";
  subject: string;
  body: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
}

interface Row {
  channel: string;
  kind: string;
  templateId: string | null;
  published: Version | null;
  draft: Version | null;
  effective: { subject: string; body: string; source: string; version: number | null; scope: "default" | "org" | "brand" };
  builtIn: { subject: string; body: string };
}

interface TemplatesData {
  scope: "org" | "brand";
  brandId: string | null;
  language: string;
  languages: string[];
  languagesUsed: string[];
  placeholders: Array<{ name: string; description: string }>;
  profile: { companyDetails: string | null; disclaimer: string | null };
  templates: Row[];
}

interface Preview {
  errors: string[];
  rendered: { subject: string; body: string };
  finding: string | null;
}

// Settings -> Takedowns -> Report templates (TAKEDOWN_AUTOMATION_PLAN.md §5). Analysts edit
// drafts; owners and admins publish them. Reports only use published text.
export function ReportTemplateSettings({ role, brands }: { role: Role | null; brands: Array<{ id: string; name: string }> }) {
  const canEdit = role === "owner" || role === "admin" || role === "analyst";
  const canPublish = role === "owner" || role === "admin";
  const [brandId, setBrandId] = useState<string>("");
  const [language, setLanguage] = useState("en");
  const [data, setData] = useState<TemplatesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ language, ...(brandId ? { brandId } : {}) });
      setData(await apiFetch<TemplatesData>(`/api/report-templates?${q}`));
    } catch (err: any) {
      setError(err.message);
    }
  }, [brandId, language]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Report templates</h2>
        <div className="mt-1 max-w-2xl text-sm leading-relaxed text-subtle">
          The wording of takedown reports for websites. Every report keeps three fixed parts you can move but not remove: the reference tag in the subject (replies are
          matched by it), the evidence block, and the signature block. Analysts edit a draft; an owner or admin publishes it. Reports use the published version, or the
          built-in text until you publish your own.
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Field label="Applies to">
          <select className="field" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                Only {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Language">
          <select className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {(data?.languages ?? ["en"]).map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l] ?? l}
                {data?.languagesUsed.includes(l) && l !== "en" ? " (in use)" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {brandId && <p className="text-xs text-subtle">A brand-only version replaces the all-brands one for that brand. Where a brand has none, the all-brands text is used.</p>}
      {language !== "en" && <p className="text-xs text-subtle">Where there is no text in this language, reports fall back to English.</p>}
      {error && <p className="text-sm text-sev-critical">{error}</p>}

      {!data ? (
        <Skeleton className="h-60 w-full" />
      ) : (
        <>
          {!brandId && <ProfileCard profile={data.profile} canEdit={canPublish} onSaved={load} />}
          <div className="card divide-y divide-border">
            {data.templates.map((row) => {
              const key = `${row.channel}.${row.kind}`;
              return (
                <div key={key}>
                  <button className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-raised/50" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                    <span className="text-sm font-medium text-foreground">
                      {CHANNEL_LABELS[row.channel] ?? row.channel} · <span className="font-normal text-muted-foreground">{KIND_LABELS[row.kind] ?? row.kind}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      {row.draft && <span className="rounded-full border border-sev-medium/40 bg-sev-medium/10 px-2 py-0.5 text-sev-medium">Draft v{row.draft.version}</span>}
                      <span className="text-subtle">
                        {row.published
                          ? `Published v${row.published.version}`
                          : row.effective.scope === "org"
                            ? "Uses the all-brands text"
                            : "Built-in text"}
                      </span>
                    </span>
                  </button>
                  {open === key && (
                    <TemplateEditor
                      row={row}
                      scope={{ brandId: brandId || null, language }}
                      placeholders={data.placeholders}
                      canEdit={canEdit}
                      canPublish={canPublish}
                      onChanged={load}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function ProfileCard({ profile, canEdit, onSaved }: { profile: TemplatesData["profile"]; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [companyDetails, setCompanyDetails] = useState(profile.companyDetails ?? "");
  const [disclaimer, setDisclaimer] = useState(profile.disclaimer ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setError(null);
    try {
      await apiFetch("/api/report-templates/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyDetails, disclaimer }) });
      setState("saved");
      await onSaved();
    } catch (err: any) {
      setError(err.message);
      setState("idle");
    }
  }

  return (
    <div className="card space-y-3 p-5">
      <h3 className="text-sm font-semibold text-foreground">Fixed text in every report</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company details" hint="Added to the signature block: registered name, address, website.">
          <textarea rows={3} className="field w-full" value={companyDetails} disabled={!canEdit} onChange={(e) => (setCompanyDetails(e.target.value), setState("idle"))} />
        </Field>
        <Field label="Disclaimer (optional)" hint="Shown where a template has {{disclaimer}}; the built-in texts end with it.">
          <textarea rows={3} className="field w-full" value={disclaimer} disabled={!canEdit} onChange={(e) => (setDisclaimer(e.target.value), setState("idle"))} />
        </Field>
      </div>
      <p className="text-xs text-subtle">The signature itself is set on the sender mailbox (Automatic reporting).</p>
      {error && <p className="text-sm text-sev-critical">{error}</p>}
      {canEdit && (
        <button className="btn-secondary" disabled={state === "saving"} onClick={save}>
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save"}
        </button>
      )}
    </div>
  );
}

function TemplateEditor({
  row,
  scope,
  placeholders,
  canEdit,
  canPublish,
  onChanged,
}: {
  row: Row;
  scope: { brandId: string | null; language: string };
  placeholders: Array<{ name: string; description: string }>;
  canEdit: boolean;
  canPublish: boolean;
  onChanged: () => Promise<void>;
}) {
  const confirm = useConfirmText();
  const start = row.draft ?? row.published ?? row.effective;
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState(start.body);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const [lastFocus, setLastFocus] = useState<"subject" | "body">("body");

  const savedDraft = row.draft;
  const dirty = savedDraft ? subject !== savedDraft.subject || body !== savedDraft.body : subject !== start.subject || body !== start.body;
  const payload = { brandId: scope.brandId, channel: row.channel, kind: row.kind, language: scope.language, subject, body };

  function insert(name: string) {
    const token = `{{${name}}}`;
    const el = lastFocus === "subject" ? subjectRef.current : bodyRef.current;
    const value = lastFocus === "subject" ? subject : body;
    const pos = el?.selectionStart ?? value.length;
    const next = value.slice(0, pos) + token + value.slice(el?.selectionEnd ?? pos);
    if (lastFocus === "subject") setSubject(next);
    else setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + token.length, pos + token.length);
    });
  }

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setMessage(null);
    try {
      await fn();
    } catch (err: any) {
      if (err instanceof ApiError && err.code === "invalid_template") {
        // The 400 body carries the list; fetch it again through preview for the details.
        const p = await apiFetch<Preview>("/api/report-templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
        setErrors(p?.errors ?? [err.message]);
      } else {
        setMessage({ ok: false, text: err.message });
      }
    } finally {
      setBusy(null);
    }
  }

  const post = (path: string, body?: unknown) =>
    apiFetch<any>(path, { method: "POST", ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });

  return (
    <div className="space-y-4 border-t border-border bg-raised/30 px-5 py-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-3">
          <Field label="Subject">
            <input
              ref={subjectRef}
              className="field w-full font-mono text-xs"
              value={subject}
              disabled={!canEdit}
              onFocus={() => setLastFocus("subject")}
              onChange={(e) => (setSubject(e.target.value), setErrors([]))}
            />
          </Field>
          <Field label="Body">
            <textarea
              ref={bodyRef}
              rows={18}
              className="field w-full font-mono text-xs leading-relaxed"
              value={body}
              disabled={!canEdit}
              onFocus={() => setLastFocus("body")}
              onChange={(e) => (setBody(e.target.value), setErrors([]))}
              spellCheck
            />
          </Field>
        </div>
        <div className="min-w-0">
          <div className="label mb-1">Placeholders</div>
          <p className="mb-2 text-xs text-subtle">Click to insert at the cursor.</p>
          <ul className="max-h-104 space-y-1 overflow-y-auto pr-1">
            {placeholders.map((p) => (
              <li key={p.name}>
                <button type="button" disabled={!canEdit} onClick={() => insert(p.name)} className="w-full rounded-sm px-1.5 py-1 text-left hover:bg-raised disabled:cursor-default" title={p.description}>
                  <code className={`text-xs ${["reportRef", "evidence", "signature"].includes(p.name) ? "font-semibold text-primary" : "text-foreground"}`}>{`{{${p.name}}}`}</code>
                  <span className="block text-[11px] leading-snug text-subtle">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="rounded-md border border-sev-critical/40 bg-sev-critical/10 px-3 py-2 text-xs text-sev-critical">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {message && <p className={`text-sm ${message.ok ? "text-ok" : "text-sev-critical"}`}>{message.text}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-secondary"
          disabled={!!busy}
          onClick={() =>
            run("preview", async () => {
              const p = await post("/api/report-templates/preview", payload);
              setPreview(p);
              setErrors(p.errors);
            })
          }
        >
          Preview
        </button>
        {canEdit && (
          <button
            className="btn-primary"
            disabled={!!busy || !dirty}
            onClick={() =>
              run("save", async () => {
                await apiFetch("/api/report-templates/draft", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                setErrors([]);
                setMessage({ ok: true, text: "Draft saved." });
                await onChanged();
              })
            }
          >
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
        )}
        {canPublish && row.templateId && savedDraft && (
          <button
            className="btn-primary"
            disabled={!!busy || dirty}
            title={dirty ? "Save the draft first" : undefined}
            onClick={() =>
              run("publish", async () => {
                if (!(await confirm(`Publish draft v${savedDraft.version}? New reports will use it.`, { confirmLabel: "Publish" }))) return;
                await post(`/api/report-templates/${row.templateId}/publish`);
                setMessage({ ok: true, text: `Published v${savedDraft.version}.` });
                await onChanged();
              })
            }
          >
            Publish
          </button>
        )}
        {canEdit && (
          <button
            className="btn-ghost"
            disabled={!!busy}
            onClick={() =>
              run("test", async () => {
                const r = await post("/api/report-templates/test", payload);
                setMessage(r.ok ? { ok: true, text: `Test sent to ${r.to}, filled in with real or sample data.` } : { ok: false, text: r.error });
              })
            }
          >
            Send test to me
          </button>
        )}
        {canEdit && (
          <button
            className="btn-ghost"
            disabled={!!busy}
            onClick={() => {
              setSubject(row.builtIn.subject);
              setBody(row.builtIn.body);
              setErrors([]);
            }}
          >
            Start from built-in text
          </button>
        )}
        {canEdit && row.templateId && savedDraft && (
          <button
            className="btn-ghost text-sev-critical"
            disabled={!!busy}
            onClick={() =>
              run("discard", async () => {
                if (!(await confirm("Discard the draft?", { danger: true, confirmLabel: "Discard" }))) return;
                await apiFetch(`/api/report-templates/${row.templateId}/draft`, { method: "DELETE" });
                const back = row.published ?? row.effective;
                setSubject(back.subject);
                setBody(back.body);
                await onChanged();
              })
            }
          >
            Discard draft
          </button>
        )}
        {canPublish && row.templateId && row.published && (
          <button
            className="btn-ghost text-sev-critical"
            disabled={!!busy}
            onClick={() =>
              run("retire", async () => {
                if (!(await confirm(`Stop using v${row.published!.version}? Reports fall back to ${scope.brandId ? "the all-brands text" : "the built-in text"}.`, { confirmLabel: "Stop using it" }))) return;
                await post(`/api/report-templates/${row.templateId}/retire`);
                await onChanged();
              })
            }
          >
            Stop using this version
          </button>
        )}
        {row.templateId && (
          <button
            className="btn-ghost"
            onClick={async () => setVersions(versions ? null : await apiFetch<Version[]>(`/api/report-templates/${row.templateId}/versions`).catch(() => []))}
          >
            {versions ? "Hide history" : "History"}
          </button>
        )}
      </div>

      {savedDraft && (
        <p className="text-xs text-subtle">
          Draft v{savedDraft.version} saved by {savedDraft.createdBy} {timeAgo(savedDraft.updatedAt)}
          {row.published ? `; reports still use v${row.published.version} until it's published.` : "; reports still use the current text until it's published."}
        </p>
      )}

      {preview && (
        <div className="rounded-md border border-border bg-card p-3">
          <div className="label mb-1">Preview{preview.finding ? `, filled in with ${preview.finding}` : ", filled in with made-up data"}</div>
          <div className="font-mono text-xs font-semibold text-foreground">{preview.rendered.subject || "(no subject: web-form text)"}</div>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">{preview.rendered.body}</pre>
        </div>
      )}

      {versions && (
        <ul className="space-y-1 text-xs">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium text-foreground">v{v.version}</span>
              <span className={v.status === "published" ? "text-ok" : v.status === "draft" ? "text-sev-medium" : "text-subtle"}>{v.status}</span>
              <span className="text-subtle">
                {v.publishedAt ? `published by ${v.publishedBy} ${timeAgo(v.publishedAt)}` : `edited by ${v.createdBy} ${timeAgo(v.updatedAt)}`}
              </span>
              {canEdit && (
                <button
                  className="text-primary hover:underline"
                  onClick={() => {
                    setSubject(v.subject);
                    setBody(v.body);
                  }}
                >
                  load into editor
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
