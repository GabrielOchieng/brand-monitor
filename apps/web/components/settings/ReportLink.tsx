"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../../lib/api";
import { CheckIcon, LinkIcon } from "../icons";

// The brand's public scam-report form link (/report/<token>): create, copy, rotate, turn off.
export function ReportLink({
  brandId,
  token,
  editable,
  onChange,
}: {
  brandId: string;
  token: string | null;
  editable: boolean;
  onChange: (token: string | null) => void;
}) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/report/${token}` : null;

  async function run(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ reportToken: string } | undefined>(`/api/brands/${brandId}/report-token`, await getToken(), { method });
      onChange(method === "POST" ? (res?.reportToken ?? null) : null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked -- the field is selectable
    }
  }

  if (!url) {
    return (
      <div>
        <p className="text-sm text-ink-muted">The public form is off for this brand.</p>
        {editable && (
          <button onClick={() => run("POST")} disabled={busy} className="btn-primary mt-3">
            <LinkIcon className="h-4 w-4" /> {busy ? "Creating…" : "Create link"}
          </button>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="field min-w-0 flex-1 font-mono text-xs" aria-label="Public report link" />
        <button onClick={copy} className="btn-secondary shrink-0">
          {copied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : null}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {editable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => window.confirm("Get a new link? The current one stops working everywhere it's been shared.") && run("POST")}
            disabled={busy}
            className="btn-ghost text-xs"
          >
            New link
          </button>
          <button onClick={() => window.confirm("Turn off the public form for this brand?") && run("DELETE")} disabled={busy} className="btn-danger text-xs">
            Turn off
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
