"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiError, apiFetch } from "../../lib/api";
import { safeNext } from "../../lib/session";
import { AuthCard, FormError } from "../../components/AuthCard";
import { GoogleButton, OrDivider, errorText, googleStartUrl, useGoogleEnabled } from "../../components/GoogleButton";
import { PasswordInput } from "../../components/ui/PasswordInput";

type LoginResponse = { mfaRequired: true; challenge: string } | { user: unknown };

// Full page load after signing in: server-rendered pages need the new cookie, and a client
// navigation followed by router.refresh() could cancel itself.
function goNext(next: string | null) {
  window.location.replace(safeNext(next));
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // ?mfa= / ?error= arrive after a redirect back from Google sign-in.
  const [challenge, setChallenge] = useState<string | null>(params.get("mfa"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(errorText(params.get("error")));
  const google = useGoogleEnabled();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if ("mfaRequired" in res) {
        setChallenge(res.challenge);
        setPassword("");
        setBusy(false);
        return;
      }
      goNext(params.get("next"));
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <SecondFactorForm
        challenge={challenge}
        onDone={() => goNext(params.get("next"))}
        onRestart={(message) => {
          setChallenge(null);
          setError(message);
        }}
      />
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {google && (
        <>
          <GoogleButton href={googleStartUrl({ mode: "login", next: safeNext(params.get("next")) })} label="Continue with Google" />
          <OrDivider />
        </>
      )}
      <div>
        <label htmlFor="email" className="label mb-1">
          Email
        </label>
        <input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="field w-full" />
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor="password" className="label">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="field w-full" />
      </div>
      <FormError message={error} />
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

// Step 2 when the account has two-factor sign-in on: a code from the authenticator app, or a
// recovery code. The challenge lasts 5 minutes and allows 5 tries; after that, back to step 1.
function SecondFactorForm({ challenge, onDone, onRestart }: { challenge: string; onDone: () => void; onRestart: (message: string) => void }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/login/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useRecovery ? { challenge, recoveryCode: value } : { challenge, code: value }),
      });
      onDone();
    } catch (err: any) {
      if (err instanceof ApiError && err.code === "invalid_or_expired_token") {
        onRestart("Too many tries, or the sign-in took too long. Enter your password again.");
        return;
      }
      setError(err.message);
      setValue("");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {useRecovery ? "Enter one of your recovery codes. Each works once." : "Enter the 6-digit code from your authenticator app."}
      </p>
      <div>
        <label htmlFor="second-factor" className="label mb-1">
          {useRecovery ? "Recovery code" : "Code"}
        </label>
        {useRecovery ? (
          <input key="recovery" id="second-factor" autoComplete="off" autoFocus required placeholder="xxxx-xxxx" value={value} onChange={(e) => setValue(e.target.value)} className="field w-full font-mono" />
        ) : (
          <input
            key="totp"
            id="second-factor"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            autoFocus
            required
            placeholder="123456"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="field w-full font-mono tracking-widest"
          />
        )}
      </div>
      <FormError message={error} />
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "Checking…" : "Verify"}
      </button>
      <button
        type="button"
        onClick={() => {
          setUseRecovery((r) => !r);
          setValue("");
          setError(null);
        }}
        className="block w-full text-center text-sm text-subtle hover:text-foreground"
      >
        {useRecovery ? "Use a code from the app instead" : "Lost your phone? Use a recovery code"}
      </button>
    </form>
  );
}

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || null;

export default function LoginPage() {
  const subtitle = (
    <>
      Accounts are by invitation. Ask an owner or admin of your organization for one.
      {CONTACT_EMAIL && (
        <>
          {" "}
          New organization?{" "}
          <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Brand Monitor: request access")}`} className="font-medium text-primary hover:underline">
            Request access
          </a>
          .
        </>
      )}
    </>
  );
  return (
    <AuthCard title="Sign in" subtitle={subtitle}>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
