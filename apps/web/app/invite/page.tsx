"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiError, apiFetch } from "../../lib/api";
import { useSession, type Me } from "../../lib/session";
import { AuthCard, FormError } from "../../components/AuthCard";
import { NewPasswordFields, newPasswordError } from "../../components/NewPasswordFields";
import { GoogleButton, OrDivider, errorText, googleStartUrl, useGoogleEnabled } from "../../components/GoogleButton";

interface InvitePreview {
  email: string;
  organizationName: string;
  role: string;
  needsPassword: boolean;
}

function AcceptInvite() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const google = useGoogleEnabled();
  const { setMe } = useSession();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  // ?error= comes back from a failed "Join with Google".
  const [error, setError] = useState<string | null>(errorText(params.get("error")));

  useEffect(() => {
    if (!token) return setLoadError("This page needs the link from your invite email.");
    apiFetch<InvitePreview>(`/auth/invite?token=${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((err) =>
        setLoadError(err instanceof ApiError && err.status === 404 ? "This invite has expired, was revoked or was already used. Ask for a new one." : err.message)
      );
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (invite?.needsPassword) {
      const invalid = newPasswordError(password, confirm);
      if (invalid) return setError(invalid);
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<Me | { joined: true; signInRequired: true }>("/auth/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invite?.needsPassword ? { token, password, name: name || undefined } : { token }),
      });
      if ("signInRequired" in res) {
        setJoined(true);
      } else {
        setMe(res);
        window.location.replace("/dashboard");
      }
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (loadError) return <p className="text-sm text-muted-foreground">{loadError}</p>;
  if (!invite) return <p className="text-sm text-subtle">Loading invite…</p>;

  if (joined) {
    return (
      <>
        <p className="text-sm text-muted-foreground">
          You've joined {invite.organizationName}. Sign in with your existing password to open it.
        </p>
        <Link href="/login" className="btn-primary mt-4 w-full">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Join <span className="font-medium text-foreground">{invite.organizationName}</span> as {invite.role === "admin" || invite.role === "analyst" ? "an" : "a"}{" "}
        <span className="font-medium text-foreground">{invite.role}</span>, signed in as <span className="font-medium text-foreground">{invite.email}</span>.
      </p>
      {invite.needsPassword && (
        <>
          {google && (
            <>
              <GoogleButton href={googleStartUrl({ mode: "invite", invite: token })} label={`Join with Google (${invite.email})`} />
              <OrDivider />
              <p className="text-xs text-subtle">Or choose a password:</p>
            </>
          )}
          <div>
            <label htmlFor="name" className="label mb-1">
              Your name (optional)
            </label>
            <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="field w-full" />
          </div>
          <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        </>
      )}
      <FormError message={error} />
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "Joining…" : `Join ${invite.organizationName}`}
      </button>
    </form>
  );
}

export default function InvitePage() {
  return (
    <AuthCard title="Accept your invite">
      <Suspense fallback={null}>
        <AcceptInvite />
      </Suspense>
    </AuthCard>
  );
}
