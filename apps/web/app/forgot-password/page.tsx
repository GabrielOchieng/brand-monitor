"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { AuthCard, FormError } from "../../components/AuthCard";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthCard title="Check your email" subtitle={`If ${email} has an account, a reset link is on its way. It works once and expires in 1 hour.`}>
        <Link href="/login" className="btn-secondary w-full">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we'll send you a link to choose a new password.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="email" className="label mb-1">
            Email
          </label>
          <input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="field w-full" />
        </div>
        <FormError message={error} />
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Sending…" : "Send reset link"}
        </button>
        <Link href="/login" className="block text-center text-sm text-subtle hover:text-foreground">
          Back to sign in
        </Link>
      </form>
    </AuthCard>
  );
}
