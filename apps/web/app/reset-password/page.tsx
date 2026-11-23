"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { AuthCard, FormError } from "../../components/AuthCard";
import { NewPasswordFields, newPasswordError } from "../../components/NewPasswordFields";

// Also the landing page for "set your password" emails (existing users after the move off Clerk).
function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = newPasswordError(password, confirm);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <>
        <p className="text-sm text-ink-muted">This page needs the link from your email.</p>
        <Link href="/forgot-password" className="btn-secondary mt-4 w-full">
          Send a new link
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <p className="text-sm text-ink-muted">Your password is set. You've been signed out everywhere else; sign in with the new password.</p>
        <Link href="/login" className="btn-primary mt-4 w-full">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
      <FormError message={error} />
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "Saving…" : "Set password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a password">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </AuthCard>
  );
}
