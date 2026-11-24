"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL, apiFetch } from "../../lib/api";
import { authorizationStatus, BLOCKER_LABELS, DOCUMENT_KIND_LABELS, formatBytes, PROVIDER_LABELS } from "../../lib/autoTakedown";
import { ago, day } from "./AdminShell";

interface AdminAutoTakedown {
  platformEnabled: boolean;
  allowedAt: string | null;
  allowedBy: string | null;
  blockers: string[];
  sender: { provider: string; fromAddress: string; fromName: string | null; lastTestAt: string | null; lastTestOk: boolean | null; lastTestError: string | null } | null;
  automation: { enabledAt: string | null; enabledBy: string | null; stoppedAt: string | null; stoppedBy: string | null } | null;
  authorizations: Array<{
    id: string;
    brandName: string | null;
    brandId: string | null;
    signatoryName: string;
    signatoryTitle: string;
    signatoryEmail: string;
    signatoryPhone: string | null;
    scope: string | null;
    validFrom: string;
    expiresAt: string | null;
    revokedAt: string | null;
    createdBy: string;
    createdAt: string;
    documents: Array<{ id: string; kind: string; filename: string; sizeBytes: number; sha256: string; uploadedBy: string; createdAt: string }>;
  }>;
}

// Admin org page: the org's automatic takedown reporting setup, and the allow switch. Allowing
// it means the admin has read the authorization and its documents.
export function AutoTakedownAdmin({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [data, setData] = useState<AdminAutoTakedown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<AdminAutoTakedown>(`/api/admin/orgs/${orgId}/auto-takedown`));
    } catch (err: any) {
      setError(err.message);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function setAllowed(allow: boolean) {
    const text = allow
      ? `Allow automatic takedown reporting for ${orgName}? Do this only after reading the authorization and its documents below. The org's owner still has to turn it on.`
      : `Withdraw the allowance for ${orgName}? Automatic reporting stops for the whole organization.`;
    if (!window.confirm(text)) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/orgs/${orgId}/auto-takedown/${allow ? "allow" : "disallow"}`, { method: "POST" });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="text-sm text-red-600">{error}</p> : null;
  const inForce = data.authorizations.filter((a) => authorizationStatus(a) === "in_force");

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-ink">Automatic takedown reporting</h2>
      <div className="card space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-ink">
            {data.allowedAt ? (
              <>
                Allowed {day(data.allowedAt)}
                {data.allowedBy ? ` by ${data.allowedBy}` : ""}
              </>
            ) : (
              "Not allowed"
            )}
            <span className="ml-2 text-xs text-ink-subtle">
              Owner switch: {data.automation?.enabledAt ? `on (${data.automation.enabledBy ?? "owner"})` : "off"}
              {data.automation?.stoppedAt ? ` · stopped by ${data.automation.stoppedBy ?? "a member"}` : ""}
              {!data.platformEnabled ? " · AUTO_TAKEDOWN_ENABLED is off on this server" : ""}
            </span>
          </div>
          {data.allowedAt ? (
            <button className="btn-secondary" disabled={busy} onClick={() => setAllowed(false)}>
              Withdraw
            </button>
          ) : (
            <button className="btn-primary" disabled={busy || inForce.length === 0} title={inForce.length === 0 ? "No authorization in force" : undefined} onClick={() => setAllowed(true)}>
              Allow
            </button>
          )}
        </div>
        {data.blockers.length > 0 && (
          <ul className="space-y-0.5 text-xs text-ink-muted">
            {data.blockers.map((b) => (
              <li key={b}>• {BLOCKER_LABELS[b] ?? b}</li>
            ))}
          </ul>
        )}
        <div className="text-xs text-ink-muted">
          Sender:{" "}
          {data.sender
            ? `${PROVIDER_LABELS[data.sender.provider] ?? data.sender.provider}, ${data.sender.fromAddress} · last test ${
                data.sender.lastTestAt ? `${data.sender.lastTestOk ? "passed" : "failed"} ${ago(data.sender.lastTestAt)}` : "none"
              }`
            : "none"}
        </div>

        {data.authorizations.length === 0 ? (
          <p className="text-xs text-ink-subtle">No authorization recorded.</p>
        ) : (
          <ul className="space-y-2">
            {data.authorizations.map((a) => (
              <li key={a.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <div className="font-medium text-ink">
                      {a.signatoryName}, {a.signatoryTitle}
                    </div>
                    <div className="text-xs text-ink-subtle">
                      {a.signatoryEmail}
                      {a.signatoryPhone ? ` · ${a.signatoryPhone}` : ""} · {a.brandId ? (a.brandName ?? "deleted brand") : "all brands"} · {day(a.validFrom)} to{" "}
                      {a.expiresAt ? day(a.expiresAt) : "no end date"} · recorded by {a.createdBy}
                    </div>
                    {a.scope && <div className="mt-1 text-xs text-ink-muted">{a.scope}</div>}
                  </div>
                  <span className="text-xs capitalize text-ink-subtle">{authorizationStatus(a).replace("_", " ")}</span>
                </div>
                <ul className="mt-2 space-y-0.5 text-xs">
                  {a.documents.length === 0 && <li className="text-ink-subtle">No documents.</li>}
                  {a.documents.map((d) => (
                    <li key={d.id}>
                      <a className="text-brand hover:underline" href={`${API_URL}/api/admin/orgs/${orgId}/takedown-documents/${d.id}`}>
                        {d.filename}
                      </a>{" "}
                      <span className="text-ink-subtle">
                        {DOCUMENT_KIND_LABELS[d.kind] ?? d.kind} · {formatBytes(d.sizeBytes)} · sha256 {d.sha256.slice(0, 12)}…
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}
