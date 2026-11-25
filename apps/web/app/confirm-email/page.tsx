"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { AuthCard } from "../../components/AuthCard";

// Landing page for the "confirm your new email" link. Works signed out (the link may be opened
// on another device); the change applies as soon as the page loads.
function Confirm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    // Once only: the token is single-use, and React may run effects twice in development.
    if (sent.current) return;
    sent.current = true;
    if (!token) return setState({ ok: false, text: "This page needs the link from your email." });
    apiFetch<{ email: string }>("/auth/email/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => setState({ ok: true, text: `Your email is now ${r.email}. Use it the next time you sign in.` }))
      .catch((err) => setState({ ok: false, text: err.message }));
  }, [token]);

  if (!state) return <p className="text-sm text-ink-subtle">Confirming…</p>;
  return (
    <>
      <p className={`text-sm ${state.ok ? "text-ink-muted" : "text-sev-critical"}`}>{state.text}</p>
      <Link href={state.ok ? "/account" : "/login"} className="btn-secondary mt-4 w-full">
        {state.ok ? "Back to your account" : "Go to sign in"}
      </Link>
    </>
  );
}

export default function ConfirmEmailPage() {
  return (
    <AuthCard title="Confirm your new email">
      <Suspense fallback={null}>
        <Confirm />
      </Suspense>
    </AuthCard>
  );
}
