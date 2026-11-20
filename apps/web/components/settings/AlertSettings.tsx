"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../../lib/api";
import { LoadingRegion, Skeleton } from "../Skeleton";
import { ReadOnlyNote, Section, Toggle } from "./Section";

type Channel = "email" | "in_app" | "webhook";

interface Rule {
  kind: string;
  enabled: boolean;
  channels: Channel[];
  config: { minSeverity?: string; minDelta?: number };
  allowedChannels: Channel[];
}

const KINDS: Record<string, { title: string; description: string }> = {
  severity_threshold: { title: "Severity rises", description: "A finding reaches the chosen severity or higher (including on its first scan)." },
  new_finding: { title: "New finding", description: "A finding is scored for the first time at the chosen severity or higher." },
  score_increase: { title: "Score jumps", description: "A finding's risk score rises by at least the chosen number of points between scans." },
  website_activated: { title: "Site goes live", description: "A registered but empty domain starts serving a real website." },
  site_reactivated: { title: "Site back online", description: "A site confirmed down after a takedown is live again." },
  registration_changed: { title: "Registration changed", description: "A domain's registrar, nameservers, IP or registry status changes." },
  public_report: { title: "Public report", description: "Someone submits the public scam-report form. In-app only." },
};

const CHANNEL_LABELS: Record<Channel, string> = { email: "Email", in_app: "In-app", webhook: "Webhook" };
const SEVERITIES = ["low", "medium", "high", "critical"];

// One row per alert type: on/off, where it goes, and its threshold. Saved per change.
export function AlertSettings({ editable }: { editable: boolean }) {
  const { getToken } = useAuth();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [savingKind, setSavingKind] = useState<string | null>(null);
  const [savedKind, setSavedKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webhookOn, setWebhookOn] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const [data, webhook] = await Promise.all([
          apiFetch<{ rules: Rule[] }>("/api/alert-rules", token),
          apiFetch<{ enabled: boolean } | null>("/api/webhook-config", token).catch(() => null),
        ]);
        setRules(data.rules);
        setWebhookOn(Boolean(webhook?.enabled));
      } catch (err: any) {
        setError(err.message);
        setRules([]);
      }
    })();
  }, [getToken]);

  async function save(next: Rule) {
    const previous = rules;
    setRules((prev) => (prev ?? []).map((r) => (r.kind === next.kind ? next : r)));
    setSavingKind(next.kind);
    setSavedKind(null);
    setError(null);
    try {
      await apiFetch(`/api/alert-rules/${next.kind}`, await getToken(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next.enabled, channels: next.channels, config: next.config }),
      });
      setSavedKind(next.kind);
      setTimeout(() => setSavedKind((k) => (k === next.kind ? null : k)), 1500);
    } catch (err: any) {
      setError(err.message);
      setRules(previous);
    } finally {
      setSavingKind(null);
    }
  }

  function toggleChannel(rule: Rule, channel: Channel) {
    const channels = rule.channels.includes(channel) ? rule.channels.filter((c) => c !== channel) : [...rule.channels, channel];
    save({ ...rule, channels });
  }

  return (
    <div className="space-y-8">
      {!editable && <ReadOnlyNote />}
      <Section
        title="Alerts"
        description={
          <>
            What sends an alert, and where it goes. Changes apply from the next scan. Email goes to everyone on the team; webhooks go to the address under Integrations
            {webhookOn ? "" : " (not set up yet)"}.
          </>
        }
      >
        {rules === null ? (
          <LoadingRegion label="Loading alert rules" className="divide-y divide-line">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4 py-4 first:pt-0">
                <Skeleton className="h-5 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
              </div>
            ))}
          </LoadingRegion>
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((rule) => {
              const meta = KINDS[rule.kind] ?? { title: rule.kind, description: "" };
              const busy = savingKind === rule.kind;
              return (
                <li key={rule.kind} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start">
                  <div className="flex flex-1 items-start gap-4">
                    <div className="pt-0.5">
                      <Toggle checked={rule.enabled} onChange={(v) => save({ ...rule, enabled: v })} disabled={!editable || busy} label={`${meta.title} alerts`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-ink">
                        {meta.title}
                        {savedKind === rule.kind && <span className="text-xs font-normal text-emerald-700">Saved</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-subtle">{meta.description}</p>
                      {rule.enabled && rule.channels.length === 0 && <p className="mt-1 text-xs text-amber-700">On, but no channel is selected, so nothing is sent.</p>}
                    </div>
                  </div>

                  <div className={`flex flex-wrap items-center gap-3 pl-[52px] sm:pl-0 ${rule.enabled ? "" : "opacity-50"}`}>
                    {rule.config.minSeverity !== undefined && (
                      <select
                        value={rule.config.minSeverity}
                        onChange={(e) => save({ ...rule, config: { ...rule.config, minSeverity: e.target.value } })}
                        disabled={!editable || busy || !rule.enabled}
                        className="field-sm"
                        aria-label={`${meta.title}: minimum severity`}
                      >
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {s[0].toUpperCase() + s.slice(1)}+
                          </option>
                        ))}
                      </select>
                    )}
                    {rule.config.minDelta !== undefined && (
                      <select
                        value={rule.config.minDelta}
                        onChange={(e) => save({ ...rule, config: { ...rule.config, minDelta: Number(e.target.value) } })}
                        disabled={!editable || busy || !rule.enabled}
                        className="field-sm"
                        aria-label={`${meta.title}: minimum points`}
                      >
                        {[10, 15, 20, 30, 40, 50].map((d) => (
                          <option key={d} value={d}>
                            +{d} points
                          </option>
                        ))}
                      </select>
                    )}
                    {rule.allowedChannels.map((c) => (
                      <label key={c} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                        <input
                          type="checkbox"
                          checked={rule.channels.includes(c)}
                          onChange={() => toggleChannel(rule, c)}
                          disabled={!editable || busy || !rule.enabled}
                          className="accent-brand"
                        />
                        {CHANNEL_LABELS[c]}
                      </label>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      </Section>
    </div>
  );
}
