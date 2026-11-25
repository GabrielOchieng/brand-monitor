"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink } from "lucide-react";
import { TakedownStatusSchema } from "@brand-monitor/shared";
import { apiFetch } from "../../lib/api";
import { fullDate, timeAgo } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Panel, PanelBody, PanelHeader, SectionTitle } from "../ui/Panel";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Banner";
import { Input, Select } from "../ui/Field";
import { useToast } from "../ui/Toast";
import { useCanEditReports } from "./ReportFlow";

const TAKEDOWN_STATUSES = TakedownStatusSchema.options;
const TAKEDOWN_STATUS_LABELS: Record<string, string> = { requested: "Requested", acknowledged: "Acknowledged", completed: "Taken down", rejected: "Rejected" };

interface Takedown {
  id: string;
  provider: string;
  reference: string | null;
  status: (typeof TAKEDOWN_STATUSES)[number];
  notes: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

// Mirrors apps/api/src/lib/takedownKit.ts KitChannel.
export interface KitChannel {
  key: string;
  trackerLabel: string;
  title: string;
  kind: "email" | "form" | "sms" | "app";
  to: string | null;
  subject: string | null;
  body: string;
  openUrl: string | null;
  instructions: string;
}

export interface TakedownContact {
  provider: string;
  contact: string | null;
}

const KIND_LABEL: Record<KitChannel["kind"], string> = { email: "Email", form: "Web form", sms: "SMS", app: "In app" };

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <Button size="sm" variant="ghost" onClick={copy} className="h-6 px-1.5">
      {state === "copied" ? <Check /> : <Copy />}
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy it yourself" : label}
    </Button>
  );
}

type Props = {
  findingId: string;
  // Registrar / host abuse contacts from the domain's RDAP data, offered as one-click fills.
  contacts?: TakedownContact[];
  // Latest scan saw real content: a "taken down" record with a live site means only part of it
  // worked, or it's back.
  siteLive?: boolean;
};

// Reports made outside the org mailbox: a do-it-yourself kit per channel (each one logged when
// done, so time to takedown is measured per channel) and the log of every request and outcome.
export function TakedownLog({ findingId, contacts = [], siteLive = false }: Props) {
  const canEdit = useCanEditReports();
  const toast = useToast();
  const [takedowns, setTakedowns] = useState<Takedown[]>([]);
  const [kit, setKit] = useState<KitChannel[]>([]);
  const [openKit, setOpenKit] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ provider: "", reference: "", notes: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setTakedowns(await apiFetch<Takedown[]>(`/api/findings/${findingId}/takedowns`));
  }, [findingId]);

  useEffect(() => {
    load().catch(() => {});
    apiFetch<{ channels: KitChannel[] }>(`/api/findings/${findingId}/takedown-kit`)
      .then((d) => setKit(d.channels))
      .catch(() => {});
  }, [load, findingId]);

  // First time each provider label was logged, for the kit's "Reported" markers.
  const reportedAt: Record<string, string> = {};
  for (const t of takedowns) if (!reportedAt[t.provider] || t.requestedAt < reportedAt[t.provider]) reportedAt[t.provider] = t.requestedAt;

  async function log(body: { provider: string; reference?: string; notes?: string }) {
    setError(null);
    await apiFetch(`/api/findings/${findingId}/takedowns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await load();
  }

  async function markKit(c: KitChannel) {
    setBusy(c.key);
    try {
      await log({
        provider: c.trackerLabel,
        notes: `Reported via takedown kit${c.to ? ` to ${c.to}` : c.openUrl && !c.openUrl.startsWith("mailto:") ? ` (${c.openUrl})` : ""}`.slice(0, 5000),
      });
      toast(`Logged: ${c.title}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.provider.trim()) return;
    setBusy("form");
    try {
      await log({ provider: form.provider, reference: form.reference || undefined, notes: form.notes || undefined });
      setForm({ provider: "", reference: "", notes: "" });
      toast("Takedown request logged");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // A takedown record is a compliance log, so a failed save reverts the select rather than
  // leaving a value on screen that the server doesn't have.
  async function changeStatus(id: string, prev: string, next: string) {
    setTakedowns((all) => all.map((t) => (t.id === id ? { ...t, status: next as Takedown["status"] } : t)));
    setError(null);
    try {
      const updated = await apiFetch<Takedown>(`/api/findings/${findingId}/takedowns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
      setTakedowns((all) => all.map((t) => (t.id === id ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTakedowns((all) => all.map((t) => (t.id === id ? { ...t, status: prev as Takedown["status"] } : t)));
    }
  }

  const done = kit.filter((c) => reportedAt[c.trackerLabel]).length;

  return (
    <Panel>
      <PanelHeader title="Takedown log" count={takedowns.length || undefined} />
      <PanelBody className="flex flex-col gap-4">
        {siteLive && takedowns.some((t) => t.status === "completed") && (
          <Banner tone="error" title="Marked taken down, but the site is still live.">
            Removing content leaves the domain with the attacker. Ask the registrar to suspend the domain (clientHold) as well.
          </Banner>
        )}

        {kit.length > 0 && (
          <div>
            <SectionTitle action={<span className="text-xs text-subtle tabular">{done} of {kit.length} reported</span>}>Report it yourself</SectionTitle>
            <p className="mb-2 text-xs text-subtle">Places that take reports by form or other channels. Report to all of them at once: whichever acts first wins.</p>
            <ul className="overflow-hidden rounded-md border border-border">
              {kit.map((c) => {
                const isOpen = openKit === c.key;
                const reported = reportedAt[c.trackerLabel];
                return (
                  <li key={c.key} className="border-b border-border text-[13px] last:border-b-0">
                    <button type="button" onClick={() => setOpenKit(isOpen ? null : c.key)} aria-expanded={isOpen} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-hover">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{c.title}</span>
                        <span className="shrink-0 rounded-sm border border-border px-1.5 text-[10px] uppercase tracking-wide text-subtle">{KIND_LABEL[c.kind]}</span>
                      </span>
                      <span className={cn("flex shrink-0 items-center gap-1 text-xs", reported ? "text-ok" : "text-subtle")}>
                        {reported ? `Reported ${timeAgo(reported)}` : "Prepare"}
                        <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                      </span>
                    </button>
                    {isOpen && (
                      <div className="flex flex-col gap-2.5 border-t border-border bg-background px-3 py-3">
                        <p className="text-muted-foreground">{c.instructions}</p>
                        {c.to && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="w-14 text-xs text-subtle">{c.kind === "sms" ? "Send to" : c.kind === "app" ? "Number" : "To"}</span>
                            <span className="font-mono text-xs select-all">{c.to}</span>
                            <CopyButton text={c.to} />
                          </div>
                        )}
                        {c.subject && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="w-14 text-xs text-subtle">Subject</span>
                            <span className="min-w-0 text-xs">{c.subject}</span>
                            <CopyButton text={c.subject} />
                          </div>
                        )}
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-xs text-subtle">{c.kind === "sms" ? "Message" : "Report text"}</span>
                            <CopyButton text={c.body} label="Copy text" />
                          </div>
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-sunk p-3 font-mono text-xs text-muted-foreground">{c.body}</pre>
                          {c.body.includes("[Your name]") && <p className="mt-1 text-xs text-subtle">Replace [Your name] and [Your role] before sending.</p>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {c.openUrl && (
                            <Button size="sm" asChild>
                              <a href={c.openUrl} {...(c.openUrl.startsWith("mailto:") ? {} : { target: "_blank", rel: "noreferrer" })}>
                                <ExternalLink />
                                {c.kind === "email" ? "Open in email" : c.kind === "form" ? "Open form" : "Open"}
                              </a>
                            </Button>
                          )}
                          {canEdit && (
                            <Button size="sm" variant="primary" disabled={busy === c.key} onClick={() => markKit(c)}>
                              <Check />
                              {busy === c.key ? "Logging…" : reported ? "Log another report" : "Mark as reported"}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div>
          <SectionTitle>Requests and outcomes</SectionTitle>
          {takedowns.length === 0 ? (
            <p className="text-[13px] text-subtle">No takedown requests logged yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {takedowns.map((t) => (
                <li key={t.id} className="rounded-md border border-border px-3 py-2.5 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{t.provider}</span>
                      {t.reference && <span className="ml-2 font-mono text-xs text-subtle">{t.reference}</span>}
                    </div>
                    <Select aria-label={`Outcome of the report to ${t.provider}`} className="h-7 w-auto" value={t.status} disabled={!canEdit} onChange={(e) => changeStatus(t.id, t.status, e.target.value)}>
                      {TAKEDOWN_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {TAKEDOWN_STATUS_LABELS[s] ?? s}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {t.notes && <p className="mt-1 text-muted-foreground">{t.notes}</p>}
                  <div className="mt-1 text-xs text-subtle">
                    Requested <span title={fullDate(t.requestedAt)}>{timeAgo(t.requestedAt)}</span>
                    {t.resolvedAt && (
                      <>
                        {" "}
                        · resolved <span title={fullDate(t.resolvedAt)}>{timeAgo(t.resolvedAt)}</span>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {canEdit && (
          <form onSubmit={create} className="flex flex-col gap-2 border-t border-border pt-3">
            <SectionTitle>Log a request made elsewhere</SectionTitle>
            {contacts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-subtle">Fill from:</span>
                {contacts.map((c) => (
                  <Button key={c.provider} size="sm" variant="ghost" className="h-6 border border-border px-2" onClick={() => setForm({ provider: c.provider, reference: "", notes: c.contact ? `Reported to ${c.contact}` : "" })}>
                    {c.provider}
                  </Button>
                ))}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="Provider" placeholder="Provider (e.g. registrar)" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
              <Input aria-label="Reference" mono placeholder="Ticket or case number (optional)" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Input aria-label="Notes" placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              <Button type="submit" disabled={busy === "form" || !form.provider.trim()}>
                Log
              </Button>
            </div>
          </form>
        )}
        {error && <p className="text-[13px] text-sev-critical">{error}</p>}
      </PanelBody>
    </Panel>
  );
}
