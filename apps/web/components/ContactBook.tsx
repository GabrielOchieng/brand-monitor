"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "../lib/api";
import { CHANNEL_LABELS, LANGUAGE_LABELS } from "../lib/autoTakedown";

// Contact-book entries (lib/recipients.ts in the API): used for the org's own book (Settings ->
// Report recipients) and the platform book (/admin/contacts). Same shape, different endpoint.

export interface ContactRule {
  id: string;
  channel: string;
  matchType: string;
  matchValue: string;
  method: string;
  emails: string[];
  formUrl: string | null;
  instructions: string | null;
  language: string | null;
  note: string | null;
  enabled: boolean;
  createdBy?: string;
  updatedBy?: string;
  updatedAt: string;
}

const MATCH_LABELS: Record<string, string> = {
  iana_id: "Registrar IANA ID",
  name: "Name contains",
  tld: "Domain ends in",
  any: "Every report",
};
const METHOD_LABELS: Record<string, string> = {
  email: "Email",
  form: "Web form (manual task)",
  skip: "Don't report here",
};

export function describeMatch(c: Pick<ContactRule, "matchType" | "matchValue">): string {
  if (c.matchType === "any") return "Every report on this channel";
  if (c.matchType === "tld") return `Domains ending in .${c.matchValue}`;
  if (c.matchType === "iana_id") return `IANA ID ${c.matchValue}`;
  return `Name contains "${c.matchValue}"`;
}

function describeTarget(c: ContactRule): string {
  if (c.method === "email") return c.emails.join(", ");
  if (c.method === "form") return c.formUrl ?? "";
  return "Not reported through this channel";
}

export function ContactTable({ contacts, editable, onEdit, onDelete }: { contacts: ContactRule[]; editable: boolean; onEdit?: (c: ContactRule) => void; onDelete?: (c: ContactRule) => void }) {
  if (contacts.length === 0) return <p className="text-sm text-subtle">No entries.</p>;
  return (
    <ul className="divide-y divide-border">
      {contacts.map((c) => (
        <li key={c.id} className={`flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm ${c.enabled ? "" : "opacity-60"}`}>
          <div className="min-w-0">
            <div className="text-foreground">
              <span className="font-medium">{CHANNEL_LABELS[c.channel] ?? c.channel}</span>
              <span className="text-muted-foreground"> · {describeMatch(c)}</span>
              {!c.enabled && <span className="ml-2 text-xs text-subtle">(off)</span>}
            </div>
            <div className="break-all text-xs text-muted-foreground">
              {METHOD_LABELS[c.method] ?? c.method}: {describeTarget(c)}
              {c.language ? ` · ${LANGUAGE_LABELS[c.language] ?? c.language}` : ""}
            </div>
            {c.instructions && <div className="mt-0.5 text-xs text-subtle">{c.instructions}</div>}
            {c.note && <div className="mt-0.5 text-xs italic text-subtle">{c.note}</div>}
          </div>
          {editable && (
            <div className="flex shrink-0 gap-1">
              <button className="btn-ghost text-xs" onClick={() => onEdit?.(c)}>
                Edit
              </button>
              <button className="btn-ghost text-xs text-sev-critical" onClick={() => onDelete?.(c)}>
                Delete
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

const blank = { channel: "registrar", matchType: "name", matchValue: "", method: "email", emails: "", formUrl: "", instructions: "", language: "", note: "", enabled: true };

export function ContactForm({ endpoint, existing, onDone, onCancel }: { endpoint: string; existing: ContactRule | null; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState(
    existing
      ? { ...existing, emails: existing.emails.join(", "), formUrl: existing.formUrl ?? "", instructions: existing.instructions ?? "", language: existing.language ?? "", note: existing.note ?? "" }
      : blank
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  // Which matches make sense per channel.
  const matchTypes = f.channel === "registrar" ? ["iana_id", "name", "tld", "any"] : f.channel === "host" ? ["name", "tld", "any"] : ["tld", "any"];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors([]);
    const body = {
      channel: f.channel,
      matchType: f.matchType,
      matchValue: f.matchType === "any" ? "*" : f.matchValue,
      method: f.method,
      emails: f.method === "email" ? f.emails.split(/[\s,;]+/).filter(Boolean) : [],
      formUrl: f.method === "form" ? f.formUrl : null,
      instructions: f.instructions || null,
      language: f.language || null,
      note: f.note || null,
      enabled: f.enabled,
    };
    try {
      await apiFetch(existing ? `${endpoint}/${existing.id}` : endpoint, {
        method: existing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onDone();
    } catch (err: any) {
      setErrors([err.message]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label mb-1">Channel</span>
          <select
            className="field w-full"
            value={f.channel}
            onChange={(e) => {
              const channel = e.target.value;
              setF((x) => ({ ...x, channel, matchType: channel === "blocklist" || channel === "cert" ? "any" : x.matchType, method: channel === "blocklist" ? "form" : x.method }));
            }}
          >
            {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label mb-1">Applies to</span>
          <select className="field w-full" value={f.matchType} onChange={set("matchType")}>
            {matchTypes.map((m) => (
              <option key={m} value={m}>
                {MATCH_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        {f.matchType !== "any" && (
          <label className="block">
            <span className="label mb-1">{f.matchType === "iana_id" ? "IANA ID" : f.matchType === "tld" ? "Ending (e.g. ke, co.ke)" : "Name (e.g. GoDaddy)"}</span>
            <input required className="field w-full" value={f.matchValue} onChange={set("matchValue")} />
          </label>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="label mb-1">How</span>
          <select className="field w-full" value={f.method} onChange={set("method")}>
            {(f.channel === "blocklist" ? ["form", "skip"] : ["email", "form", "skip"]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        {f.method === "email" && (
          <label className="block sm:col-span-2">
            <span className="label mb-1">Addresses</span>
            <input required className="field w-full" value={f.emails} onChange={set("emails")} placeholder="abuse@registrar.example, phishing@registrar.example" />
          </label>
        )}
        {f.method === "form" && (
          <label className="block sm:col-span-2">
            <span className="label mb-1">Form address</span>
            <input required type="url" className="field w-full" value={f.formUrl} onChange={set("formUrl")} placeholder="https://" />
          </label>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="label mb-1">Instructions (optional)</span>
          <input className="field w-full" value={f.instructions} onChange={set("instructions")} placeholder="What they need, e.g. the full URL and a screenshot" />
        </label>
        <label className="block">
          <span className="label mb-1">Report language</span>
          <select className="field w-full" value={f.language} onChange={set("language")}>
            <option value="">Default</option>
            {Object.entries(LANGUAGE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label mb-1">Note (optional, internal)</span>
        <input className="field w-full" value={f.note} onChange={set("note")} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.enabled} onChange={(e) => setF((x) => ({ ...x, enabled: e.target.checked }))} /> In use
      </label>
      {errors.map((e) => (
        <p key={e} className="text-sm text-sev-critical">
          {e}
        </p>
      ))}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : existing ? "Save" : "Add"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
