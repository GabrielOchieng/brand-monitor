"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { API_URL } from "../lib/api";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string;
      reset: (id?: string) => void;
    };
  }
}

const ERROR_TEXT: Record<string, string> = {
  invalid_url: "That link doesn't look right. Copy it straight from the browser's address bar.",
  target_not_allowed: "That link can't be checked.",
  captcha_failed: "Please complete the check above the button and try again.",
  too_many_reports: "You've sent several reports already. Please try again in an hour.",
  invalid_request: "Please give a link or a phone number.",
};

// Cloudflare Turnstile only when a site key is configured; otherwise the API skips the
// check too (honeypot + rate limit only).
export function ReportForm({ token, siteKey }: { token: string; siteKey: string }) {
  const [captchaToken, setCaptchaToken] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!siteKey) return;
    const render = () => {
      if (widgetRef.current && window.turnstile && widgetId.current === undefined) {
        widgetId.current = window.turnstile.render(widgetRef.current, {
          sitekey: siteKey,
          callback: setCaptchaToken,
          "expired-callback": () => setCaptchaToken(""),
        });
      }
    };
    if (window.turnstile) return render();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [siteKey]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      url: String(form.get("url") ?? "").trim() || undefined,
      phone: String(form.get("phone") ?? "").trim() || undefined,
      description: String(form.get("description") ?? "").trim() || undefined,
      reporterEmail: String(form.get("reporterEmail") ?? "").trim(),
      website: String(form.get("website") ?? ""),
      turnstileToken: captchaToken || undefined,
    };
    if (!body.url && !body.phone) {
      setError(ERROR_TEXT.invalid_request);
      return;
    }
    setState("sending");
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/public/reports/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return setState("sent");
      const data = await res.json().catch(() => ({}));
      setError(ERROR_TEXT[data?.error] ?? "Something went wrong. Please try again.");
    } catch {
      setError("Couldn't send the report. Check your connection and try again.");
    }
    setState("idle");
    if (window.turnstile && widgetId.current !== undefined) window.turnstile.reset(widgetId.current);
    setCaptchaToken("");
  }

  if (state === "sent") {
    return (
      <div className="card mt-6 p-6">
        <h2 className="text-lg font-semibold text-ink">Thank you — report received</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Our team will look into it. If you paid money or shared a PIN or password, contact your bank or mobile money
          provider right away.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
      <div>
        <label htmlFor="url" className="label">Link to the fake page</label>
        <input id="url" name="url" inputMode="url" placeholder="e.g. facebook.com/... or a website" className="field mt-1.5 w-full" />
      </div>
      <div>
        <label htmlFor="phone" className="label">Phone or WhatsApp number used</label>
        <input id="phone" name="phone" inputMode="tel" placeholder="e.g. 0712 345 678" className="field mt-1.5 w-full" />
      </div>
      <div>
        <label htmlFor="description" className="label">What happened? (optional)</label>
        <textarea id="description" name="description" rows={4} maxLength={2000} className="field mt-1.5 w-full" placeholder="e.g. They offered a refund and asked me to pay to a till number" />
      </div>
      <div>
        <label htmlFor="reporterEmail" className="label">Your email (optional, only if we may contact you)</label>
        <input id="reporterEmail" name="reporterEmail" type="email" className="field mt-1.5 w-full" />
      </div>
      {/* Honeypot: invisible to people, filled in by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {siteKey && <div ref={widgetRef} />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={state === "sending" || (Boolean(siteKey) && !captchaToken)}>
        {state === "sending" ? "Sending…" : "Send report"}
      </button>
    </form>
  );
}
