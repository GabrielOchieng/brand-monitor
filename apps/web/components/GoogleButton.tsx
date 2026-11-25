"use client";

import { useEffect, useState } from "react";
import { API_URL, apiFetch, describeErrorCode } from "../lib/api";

// Whether the API has Google sign-in configured. null while checking.
export function useGoogleEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    apiFetch<{ google: boolean }>("/auth/providers")
      .then((p) => setEnabled(p.google))
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

// A full-page navigation to the API, which redirects to Google and back.
export function googleStartUrl(params: { mode: "login" | "link" | "invite"; next?: string; invite?: string }): string {
  const q = new URLSearchParams({ mode: params.mode });
  if (params.next) q.set("next", params.next);
  if (params.invite) q.set("invite", params.invite);
  return `${API_URL}/auth/google/start?${q.toString()}`;
}

export function GoogleButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="btn-secondary w-full">
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8h-4v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z" />
      </svg>
      {label}
    </a>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-subtle">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

// Messages for ?error=<code> after a redirect back from Google.
export function errorText(code: string | null): string | null {
  return code ? describeErrorCode(code) : null;
}
