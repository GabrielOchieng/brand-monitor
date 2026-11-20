"use client";

import { useState } from "react";

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
    <button type="button" onClick={copy} className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-ink-muted hover:bg-elevated hover:text-ink">
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy manually" : label}
    </button>
  );
}

// One expandable row per reporting channel. The analyst sends each report themselves;
// "Mark as reported" logs it in the takedown tracker below so time-to-takedown is measured
// per channel.
export function TakedownKit({
  channels,
  reportedAt,
  onMarkReported,
}: {
  channels: KitChannel[];
  // trackerLabel -> when it was first logged, for channels already used.
  reportedAt: Record<string, string>;
  onMarkReported: (channel: KitChannel) => Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (channels.length === 0) return null;
  const done = channels.filter((c) => reportedAt[c.trackerLabel]).length;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">Takedown kit</h3>
        <span className="text-xs text-ink-subtle">
          {done} of {channels.length} channels reported. Report to all of them at once: whichever acts first wins.
        </span>
      </div>
      <ul className="mt-2 divide-y divide-line rounded-md border border-line">
        {channels.map((c) => {
          const isOpen = open === c.key;
          const reported = reportedAt[c.trackerLabel];
          return (
            <li key={c.key} className="text-sm">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : c.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-elevated"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-ink">{c.title}</span>
                  <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-subtle">
                    {KIND_LABEL[c.kind]}
                  </span>
                </span>
                <span className={`shrink-0 text-xs ${reported ? "text-green-700" : "text-ink-faint"}`}>
                  {reported ? `Reported ${new Date(reported).toLocaleDateString()}` : isOpen ? "Hide" : "Prepare"}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-3 border-t border-line bg-surface px-4 py-3">
                  <p className="text-ink-muted">{c.instructions}</p>

                  {c.to && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-16 text-xs text-ink-subtle">{c.kind === "sms" ? "Send to" : c.kind === "app" ? "Number" : "To"}</span>
                      <span className="font-mono text-xs text-ink">{c.to}</span>
                      <CopyButton text={c.to} />
                    </div>
                  )}
                  {c.subject && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-16 text-xs text-ink-subtle">Subject</span>
                      <span className="min-w-0 text-xs text-ink">{c.subject}</span>
                      <CopyButton text={c.subject} />
                    </div>
                  )}
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-ink-subtle">{c.kind === "sms" ? "Message" : "Report text"}</span>
                      <CopyButton text={c.body} label="Copy text" />
                    </div>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-elevated p-3 font-sans text-xs text-ink-muted">
                      {c.body}
                    </pre>
                    {c.body.includes("[Your name]") && (
                      <p className="mt-1 text-xs text-ink-faint">Replace [Your name] and [Your role] before sending.</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {c.openUrl && (
                      <a
                        href={c.openUrl}
                        {...(c.openUrl.startsWith("mailto:") ? {} : { target: "_blank", rel: "noreferrer" })}
                        className="btn-secondary"
                      >
                        {c.kind === "email" ? "Open in email" : c.kind === "form" ? "Open form" : "Open"}
                      </a>
                    )}
                    <button
                      type="button"
                      disabled={busy === c.key}
                      onClick={async () => {
                        setBusy(c.key);
                        try {
                          await onMarkReported(c);
                        } finally {
                          setBusy(null);
                        }
                      }}
                      className="btn-primary"
                    >
                      {busy === c.key ? "Logging…" : reported ? "Log another report" : "Mark as reported"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
