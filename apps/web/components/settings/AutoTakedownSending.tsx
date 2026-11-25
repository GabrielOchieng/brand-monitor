"use client";

import { useState, type ReactNode } from "react";
import { apiFetch } from "../../lib/api";
import { CHANNEL_LABELS, MODE_LABELS, SIGNAL_LABELS } from "../../lib/autoTakedown";
import { Field, Card } from "./Section";
import { useConfirm } from "../ui/Confirm";

export interface SendingData {
  automation: {
    enabledAt: string | null;
    stage?: string;
    shadowStartedAt?: string | null;
    shadowDays?: number;
    redirectTo?: string | null;
    minSeverity?: string;
    signals?: string[];
    confirmedSkipsVeto?: boolean;
    vetoHours?: number;
    dailyCap?: number;
    perRecipientCap?: number;
    followUpDays?: number;
    escalateDays?: number;
  } | null;
  channelModes: Record<string, string>;
  shadowStats: { right: number; wrong: number; unreviewed: number };
}


const STAGES = [
  { key: "shadow", label: "Test: prepare only", text: "Reports are prepared and recorded, never sent. Analysts mark each one right or wrong under Takedowns → Test mode." },
  { key: "redirect", label: "Test: send to yourself", text: "Reports are sent, but all to your test address (Report recipients), to check the wording and delivery." },
  { key: "live", label: "Live", text: "Reports go to their real recipients." },
];

// Settings -> Automatic reporting: when reports are made and sent (TAKEDOWN_AUTOMATION_PLAN.md §6, §7, §10).
export function AutoTakedownSending({ data, role, onChange, onError }: { data: SendingData; role: string | null; onChange: () => Promise<void>; onError: (m: string | null) => void }) {
  const ask = useConfirm();
  const isOwner = role === "owner";
  const canManage = isOwner || role === "admin";
  const a = data.automation;
  const stage = a?.stage ?? "shadow";
  const shadowEnds = a?.shadowStartedAt ? new Date(new Date(a.shadowStartedAt).getTime() + (a.shadowDays ?? 14) * 86400_000) : null;
  const reviewed = data.shadowStats.right + data.shadowStats.wrong;

  const [policy, setPolicy] = useState({
    minSeverity: a?.minSeverity ?? "critical",
    signals: a?.signals ?? ["login_form", "payment_form", "shared_indicator", "scam_pattern"],
    confirmedSkipsVeto: a?.confirmedSkipsVeto ?? true,
    vetoHours: a?.vetoHours ?? 6,
    dailyCap: a?.dailyCap ?? 25,
    perRecipientCap: a?.perRecipientCap ?? 5,
    followUpDays: a?.followUpDays ?? 2,
    escalateDays: a?.escalateDays ?? 5,
  });
  const [modes, setModes] = useState<Record<string, string>>(data.channelModes);
  const [saved, setSaved] = useState<string | null>(null);

  async function put(path: string, body: unknown, what: string) {
    onError(null);
    setSaved(null);
    try {
      await apiFetch(path, { method: path.endsWith("stage") ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setSaved(what);
      await onChange();
    } catch (err: any) {
      onError(err.message);
    }
  }

  return (
    <>
      <Card title="Stage" description="Every organization starts in test mode. Going live needs the test period to have passed, so you've seen what would have been sent.">
        <div className="grid gap-2 sm:grid-cols-3">
          {STAGES.map((s) => (
            <div key={s.key} className={`rounded-md border p-3 ${stage === s.key ? "border-brand bg-brand/5" : "border-line"}`}>
              <div className="text-sm font-medium text-ink">
                {s.label}
                {stage === s.key && <span className="ml-2 text-xs font-normal text-brand">current</span>}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-subtle">{s.text}</p>
              {isOwner && stage !== s.key && (
                <button
                  className="btn-secondary mt-2 text-xs"
                  onClick={async () => (await ask({ title: `Switch to ${s.label === "Live" ? "live" : s.label.toLowerCase()}?`, body: s.text, confirmLabel: "Switch" })) && put("/api/takedown-automation/stage", { stage: s.key }, "stage")}
                >
                  Switch to {s.label === "Live" ? "live" : s.label.charAt(0).toLowerCase() + s.label.slice(1)}
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          Test-mode review: {data.shadowStats.right} right, {data.shadowStats.wrong} wrong, {data.shadowStats.unreviewed} not reviewed
          {reviewed > 0 ? ` (${Math.round((data.shadowStats.wrong / reviewed) * 100)}% wrong)` : ""}.
          {shadowEnds && (shadowEnds > new Date() ? ` Live is possible from ${shadowEnds.toLocaleDateString()}.` : " The test period is over.")}
          {!a?.shadowStartedAt && " The test period starts when automatic reporting is turned on."}
        </p>
      </Card>

      <Card title="Channels" description="What happens when a finding qualifies. Web-form-only recipients (e.g. GoDaddy) always become a manual task.">
        <div className="space-y-2">
          {(["registrar", "host", "cert", "blocklist"] as const).map((ch) => (
            <label key={ch} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-ink">{CHANNEL_LABELS[ch]}</span>
              <select className="field w-80 max-w-full" value={modes[ch] ?? "off"} disabled={!canManage} onChange={(e) => setModes((m) => ({ ...m, [ch]: e.target.value }))}>
                {Object.entries(MODE_LABELS)
                  .filter(([k]) => ch !== "blocklist" || k === "off" || k === "approval")
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {ch === "blocklist" && k === "approval" ? "On: a manual task per finding (web forms)" : v}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
        {canManage && (
          <button className="btn-secondary mt-3" onClick={() => put("/api/takedown-automation/channel-modes", modes, "channels")}>
            {saved === "channels" ? "Saved" : "Save channels"}
          </button>
        )}
      </Card>

      <Card title="Which findings qualify" description="Only clear fraud is reported automatically: registrars act on phishing and scams, not on a lookalike name alone. A finding also has to be live on 2 scans in a row, with a screenshot from the last 24 hours.">
        <div className="space-y-3 text-sm">
          <Field label="Minimum severity (an analyst's confirmation overrides it)">
            <select className="field w-60" value={policy.minSeverity} disabled={!canManage} onChange={(e) => setPolicy((p) => ({ ...p, minSeverity: e.target.value }))}>
              <option value="critical">Critical</option>
              <option value="high">High or critical</option>
            </select>
          </Field>
          <fieldset>
            <legend className="label mb-1">…and at least one of these fraud signals</legend>
            {Object.entries(SIGNAL_LABELS).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={policy.signals.includes(k)}
                  onChange={(e) => setPolicy((p) => ({ ...p, signals: e.target.checked ? [...p.signals, k] : p.signals.filter((x) => x !== k) }))}
                />
                {v}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Veto window (hours)">
              <input type="number" min={1} max={72} className="field w-full" value={policy.vetoHours} disabled={!canManage} onChange={(e) => setPolicy((p) => ({ ...p, vetoHours: Number(e.target.value) }))} />
            </Field>
            <Field label="Reports per day, at most">
              <input type="number" min={1} max={200} className="field w-full" value={policy.dailyCap} disabled={!canManage} onChange={(e) => setPolicy((p) => ({ ...p, dailyCap: Number(e.target.value) }))} />
            </Field>
            <Field label="Per recipient per day, at most">
              <input type="number" min={1} max={50} className="field w-full" value={policy.perRecipientCap} disabled={!canManage} onChange={(e) => setPolicy((p) => ({ ...p, perRecipientCap: Number(e.target.value) }))} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Follow up after (days without a reply)" hint="Once, to the same recipients, while the site is still live.">
              <input type="number" min={1} max={30} className="field w-full" value={policy.followUpDays} disabled={!canManage} onChange={(e) => setPolicy((p) => ({ ...p, followUpDays: Number(e.target.value) }))} />
            </Field>
            <Field label="Escalate after (days still live)" hint="Registrar → hosting provider → CERT, if that channel is on.">
              <input type="number" min={1} max={60} className="field w-full" value={policy.escalateDays} disabled={!canManage} onChange={(e) => setPolicy((p) => ({ ...p, escalateDays: Number(e.target.value) }))} />
            </Field>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={!canManage} checked={policy.confirmedSkipsVeto} onChange={(e) => setPolicy((p) => ({ ...p, confirmedSkipsVeto: e.target.checked }))} />
            Findings an analyst confirmed skip the veto window
          </label>
        </div>
        {canManage && (
          <button className="btn-secondary mt-3" onClick={() => put("/api/takedown-automation/policy", policy, "policy")}>
            {saved === "policy" ? "Saved" : "Save"}
          </button>
        )}
      </Card>
    </>
  );
}
