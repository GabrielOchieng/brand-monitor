"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../../lib/api";
import { CHANNEL_LABELS } from "../../lib/autoTakedown";
import type { Role } from "../../lib/session";
import { ContactForm, ContactTable, type ContactRule } from "../ContactBook";
import { Skeleton } from "../Skeleton";
import { Field } from "./Section";

interface RecipientsData {
  contacts: ContactRule[];
  platformContacts: ContactRule[];
  fixed: Record<string, { to: string[]; cc: string[]; bcc: string[] }>;
  blocked: Array<{ id: string; value: string; reason: string; note: string | null; expiresAt: string | null; createdBy: string }>;
  ownDomains: string[];
  redirectTo: string | null;
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

const split = (s: string) => s.split(/[\s,;]+/).filter(Boolean);

// Settings -> Takedowns -> Report recipients (TAKEDOWN_AUTOMATION_PLAN.md §3).
export function ReportRecipientSettings({ role }: { role: Role | null }) {
  const canManage = role === "owner" || role === "admin";
  const isOwner = role === "owner";
  const [data, setData] = useState<RecipientsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContactRule | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<RecipientsData>("/api/report-recipients"));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function call(path: string, method: string, body?: unknown) {
    setError(null);
    try {
      await apiFetch(path, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      await load();
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  }

  if (!data) return error ? <p className="text-sm text-sev-critical">{error}</p> : <Skeleton className="h-60 w-full" />;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">Report recipients</h2>
        <div className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-subtle">
          Where takedown reports go. A report goes to the most specific entry in the contact book (yours, or the platform&apos;s shared one), else to the abuse contact in the
          registry record, else it becomes a manual task. Nothing is ever guessed. Each report on the finding page shows which rule picked its recipients.
        </div>
      </div>
      {error && <p className="text-sm text-sev-critical">{error}</p>}

      <RedirectCard redirectTo={data.redirectTo} isOwner={isOwner} onSave={(v) => call("/api/report-recipients/redirect", "PUT", { redirectTo: v })} />

      <Card
        title="Your contact book"
        description="Your own entries, e.g. a registrar contact you have a relationship with, or your national CERT (Channel: National CERT, Applies to: Every report). An entry beats a platform entry that matches the same way."
      >
        <ContactTable
          contacts={data.contacts}
          editable={canManage}
          onEdit={(c) => setEditing(c)}
          onDelete={(c) => window.confirm("Delete this entry?") && call(`/api/report-recipients/contacts/${c.id}`, "DELETE")}
        />
        {canManage && editing === null && (
          <button className="btn-secondary mt-3" onClick={() => setEditing("new")}>
            Add an entry
          </button>
        )}
        {canManage && editing !== null && (
          <div className="mt-3">
            <ContactForm
              endpoint="/api/report-recipients/contacts"
              existing={editing === "new" ? null : editing}
              onDone={() => (setEditing(null), load())}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}
      </Card>

      <Card title="Platform contact book" description="Shared by every organization and kept up to date by the platform admins. Read-only here.">
        <ContactTable contacts={data.platformContacts} editable={false} />
      </Card>

      <Card title="Always also send to" description="Added to every emailed report on the channel, e.g. Cc your legal team on registrar reports.">
        <div className="space-y-4">
          {(["registrar", "host", "cert"] as const).map((ch) => (
            <FixedRow key={ch} channel={ch} value={data.fixed[ch]} editable={canManage} onSave={(v) => call(`/api/report-recipients/fixed/${ch}`, "PUT", v)} />
          ))}
        </div>
      </Card>

      <BlockedCard data={data} editable={canManage} onAdd={(value, note) => call("/api/report-recipients/blocked", "POST", { value, note })} onRemove={(id) => call(`/api/report-recipients/blocked/${id}`, "DELETE")} />
    </section>
  );
}

function RedirectCard({ redirectTo, isOwner, onSave }: { redirectTo: string | null; isOwner: boolean; onSave: (v: string | null) => Promise<boolean> }) {
  const [value, setValue] = useState(redirectTo ?? "");
  return (
    <Card
      title="Redirect mode"
      description="For testing: every report is delivered to this one address of yours instead of its real recipients, with the real recipients shown at the top. Use it while setting up and checking templates."
    >
      {redirectTo ? (
        <p className="mb-3 rounded-md border border-sev-medium/40 bg-sev-medium/10 px-3 py-2 text-sm text-sev-medium">
          On: reports would be delivered to <strong>{redirectTo}</strong>.
        </p>
      ) : (
        <p className="mb-3 text-sm text-ink-subtle">Off.</p>
      )}
      {isOwner ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Deliver every report to">
            <input type="email" className="field w-72 max-w-full" value={value} onChange={(e) => setValue(e.target.value)} placeholder="brandprotection-test@yourcompany.com" />
          </Field>
          <button className="btn-secondary mb-0.5" disabled={!value} onClick={() => onSave(value)}>
            {redirectTo ? "Change" : "Turn on"}
          </button>
          {redirectTo && (
            <button className="btn-ghost mb-0.5" onClick={() => onSave(null).then((ok) => ok && setValue(""))}>
              Turn off
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-subtle">Only an owner can change this.</p>
      )}
    </Card>
  );
}

function FixedRow({ channel, value, editable, onSave }: { channel: string; value: { to: string[]; cc: string[]; bcc: string[] }; editable: boolean; onSave: (v: { to: string[]; cc: string[]; bcc: string[] }) => Promise<boolean> }) {
  const [f, setF] = useState({ to: value.to.join(", "), cc: value.cc.join(", "), bcc: value.bcc.join(", ") });
  const [saved, setSaved] = useState(false);
  const dirty = f.to !== value.to.join(", ") || f.cc !== value.cc.join(", ") || f.bcc !== value.bcc.join(", ");
  return (
    <div>
      <div className="text-sm font-medium text-ink">{CHANNEL_LABELS[channel]}</div>
      <div className="mt-1 grid gap-2 sm:grid-cols-3">
        {(["to", "cc", "bcc"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-xs capitalize text-ink-subtle">{k}</span>
            <input className="field-sm min-w-0 flex-1" value={f[k]} disabled={!editable} onChange={(e) => (setF((x) => ({ ...x, [k]: e.target.value })), setSaved(false))} />
          </label>
        ))}
      </div>
      {editable && (dirty || saved) && (
        <button className="btn-ghost mt-1 text-xs" disabled={!dirty} onClick={async () => setSaved(await onSave({ to: split(f.to), cc: split(f.cc), bcc: split(f.bcc) }))}>
          {saved && !dirty ? "Saved" : "Save"}
        </button>
      )}
    </div>
  );
}

function BlockedCard({ data, editable, onAdd, onRemove }: { data: RecipientsData; editable: boolean; onAdd: (value: string, note: string) => Promise<boolean>; onRemove: (id: string) => void }) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  return (
    <Card
      title="Never send to"
      description={
        <>
          Addresses (or <code>@domain</code> for a whole domain) that never get a report, in any field. Your own domains are never a report&apos;s addressee either (copies to
          your own people are fine): {data.ownDomains.length ? data.ownDomains.join(", ") : "none yet"}. Addresses that bounce will be added here automatically, for a while.
        </>
      }
    >
      {data.blocked.length === 0 ? (
        <p className="text-sm text-ink-subtle">Nothing listed.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {data.blocked.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-2">
              <span className="font-mono text-xs text-ink">{b.value}</span>
              <span className="text-xs text-ink-subtle">
                {b.reason === "bounce" ? "bounced" : "added by " + b.createdBy}
                {b.expiresAt ? `, until ${new Date(b.expiresAt).toLocaleDateString()}` : ""}
                {b.note ? ` · ${b.note}` : ""}
              </span>
              {editable && (
                <button className="text-xs text-sev-critical hover:underline" onClick={() => onRemove(b.id)}>
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Address or @domain">
            <input className="field w-64 max-w-full" value={value} onChange={(e) => setValue(e.target.value)} placeholder="@example.com" />
          </Field>
          <Field label="Why (optional)">
            <input className="field w-64 max-w-full" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <button className="btn-secondary mb-0.5" disabled={!value} onClick={async () => (await onAdd(value, note)) && (setValue(""), setNote(""))}>
            Add
          </button>
        </div>
      )}
    </Card>
  );
}
