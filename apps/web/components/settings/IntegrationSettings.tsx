"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../../lib/api";
import { CheckIcon } from "../icons";
import { LoadingRegion, Skeleton } from "../Skeleton";
import { Field, ReadOnlyNote, Section, Toggle } from "./Section";

interface WebhookConfig {
  url: string;
  enabled: boolean;
  secret: string | null; // null for roles that can't see it
}

// The alert webhook: where it posts, whether it's on, the signing secret and a test send.
export function IntegrationSettings({ editable }: { editable: boolean }) {
  const { getToken } = useAuth();
  const [config, setConfig] = useState<WebhookConfig | null | undefined>(undefined);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<WebhookConfig | null>("/api/webhook-config", await getToken());
        setConfig(data);
        setUrl(data?.url ?? "");
      } catch (err: any) {
        setError(err.message);
        setConfig(null);
      }
    })();
  }, [getToken]);

  async function save(next: { url: string; enabled: boolean }) {
    setSaving(true);
    setSaved(false);
    setError(null);
    setTestResult(null);
    try {
      const data = await apiFetch<WebhookConfig>("/api/webhook-config", await getToken(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setConfig(data);
      setUrl(data.url);
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function rotate() {
    if (!window.confirm("Make a new signing secret? The receiver must be updated with it, or it will reject the next alert.")) return;
    setError(null);
    try {
      const data = await apiFetch<WebhookConfig>("/api/webhook-config/rotate-secret", await getToken(), { method: "POST" });
      setConfig(data);
      setShowSecret(true);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      setTestResult(await apiFetch<{ ok: boolean; error?: string }>("/api/webhook-config/test", await getToken(), { method: "POST" }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  }

  async function copySecret() {
    if (!config?.secret) return;
    try {
      await navigator.clipboard.writeText(config.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setShowSecret(true);
    }
  }

  const urlChanged = url.trim() !== (config?.url ?? "");

  return (
    <div className="space-y-8">
      {!editable && <ReadOnlyNote />}
      <Section
        title="Alert webhook"
        description={
          <>
            Posts each alert as JSON to your endpoint (Slack, Teams, Zapier or your own). Each request is signed: <code className="text-[11px]">X-Signature</code> is the
            HMAC-SHA256 of <code className="text-[11px]">timestamp.body</code> with the secret, and <code className="text-[11px]">X-Timestamp</code> carries the timestamp. Choose which
            alerts use it under Alerts.
          </>
        }
      >
        {config === undefined ? (
          <LoadingRegion label="Loading webhook settings" className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-40" />
          </LoadingRegion>
        ) : (
          <div className="space-y-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save({ url: url.trim(), enabled: config?.enabled ?? true });
              }}
            >
              <Field label="Endpoint URL" hint="HTTPS only, and not a private or internal address.">
                <div className="flex gap-2">
                  <input
                    type="url"
                    required
                    disabled={!editable}
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="https://hooks.slack.com/services/…"
                    className="field min-w-0 flex-1 disabled:bg-elevated/60"
                  />
                  {editable && (
                    <button type="submit" disabled={saving || !urlChanged || !url.trim()} className="btn-primary shrink-0">
                      {saving ? "Saving…" : config ? "Save" : "Set up"}
                    </button>
                  )}
                </div>
              </Field>
              {saved && !urlChanged && <p className="mt-1 text-xs text-emerald-700">Saved</p>}
            </form>

            {config && (
              <>
                <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
                  <div>
                    <div className="text-sm font-medium text-ink">Send alerts to this webhook</div>
                    <div className="text-xs text-ink-subtle">{config.enabled ? "On" : "Off: nothing is posted, whatever the alert settings say."}</div>
                  </div>
                  <Toggle checked={config.enabled} onChange={(v) => save({ url: config.url, enabled: v })} disabled={!editable || saving} label="Webhook on" />
                </div>

                {config.secret !== null && (
                  <div className="border-t border-line pt-4">
                    <div className="label mb-1">Signing secret</div>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={showSecret ? config.secret : "•".repeat(32)}
                        className="field min-w-0 flex-1 font-mono text-xs"
                        aria-label="Signing secret"
                        onFocus={(e) => showSecret && e.currentTarget.select()}
                      />
                      <button onClick={() => setShowSecret((v) => !v)} className="btn-secondary shrink-0">
                        {showSecret ? "Hide" : "Show"}
                      </button>
                      <button onClick={copySecret} className="btn-secondary shrink-0">
                        {copied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : null}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    {editable && (
                      <button onClick={rotate} className="btn-ghost mt-2 px-0 text-xs">
                        Make a new secret
                      </button>
                    )}
                  </div>
                )}

                {editable && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                    <button onClick={test} disabled={testing} className="btn-secondary">
                      {testing ? "Sending…" : "Send a test"}
                    </button>
                    {testResult?.ok && <span className="text-xs text-emerald-700">Delivered: the endpoint accepted it.</span>}
                    {testResult && !testResult.ok && <span className="text-xs text-red-600">Not delivered: {testResult.error}</span>}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      </Section>
    </div>
  );
}
