"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "../../../lib/api";
import { useSession, type Me } from "../../../lib/session";
import { FormError } from "../../../components/AuthCard";

// You become the new organization's owner, and it becomes your active one.
export default function NewOrganizationPage() {
  const { setMe } = useSession();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await apiFetch<Me>("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setMe(me);
      window.location.assign("/dashboard");
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="card mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold text-ink">New organization</h1>
      <p className="mt-1 text-sm text-ink-muted">An organization holds brands, findings and a team. You'll be its owner and can invite others from Settings.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input required maxLength={100} placeholder="Organization name" value={name} onChange={(e) => setName(e.target.value)} className="field w-full" />
        <FormError message={error} />
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Creating…" : "Create organization"}
        </button>
      </form>
    </div>
  );
}
