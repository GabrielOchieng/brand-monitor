"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { API_URL } from "../lib/api";
import { useTurnstile } from "../lib/useTurnstile";
import { Button } from "./ui/Button";
import { Field, Input, Textarea } from "./ui/Field";
import { FormError } from "./AuthCard";

const ERROR_TEXT: Record<string, string> = {
  captcha_failed: "Please complete the check above the button and try again.",
  too_many_requests: "You've sent several requests already. Please try again in an hour.",
  invalid_request: "Please fill in every field except the message, with a valid email address.",
};

// A new organization asking for an account. Saved for the platform admins (/admin/access-requests),
// who are emailed too.
export function AccessRequestForm({ siteKey }: { siteKey: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const captcha = useTurnstile(siteKey);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (k: string) => String(form.get(k) ?? "").trim();
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/public/access-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: value("name"),
          email: value("email"),
          organization: value("organization"),
          brands: value("brands"),
          message: value("message"),
          website: String(form.get("website") ?? ""),
          turnstileToken: captcha.token || undefined,
        }),
      });
      if (res.ok) return setState("sent");
      const data = await res.json().catch(() => ({}));
      setError(ERROR_TEXT[data?.error] ?? "Something went wrong. Please try again.");
    } catch {
      setError("Couldn't send your request. Check your connection and try again.");
    }
    setState("idle");
    captcha.reset();
  }

  if (state === "sent") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] font-semibold text-foreground">Thanks, we&apos;ve got your request.</p>
        <p className="text-[13.5px] text-muted-foreground">We&apos;ll reply by email, usually within two working days, to set up your organization.</p>
        <Link href="/login" className="text-[13px] font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Your name" htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required maxLength={100} />
      </Field>
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
      </Field>
      <Field label="Organization" htmlFor="organization">
        <Input id="organization" name="organization" autoComplete="organization" required maxLength={150} />
      </Field>
      <Field label="Brands or domains to protect" htmlFor="brands" hint="For example: Example Air, example.com">
        <Input id="brands" name="brands" required maxLength={1000} />
      </Field>
      <Field label="Anything else? (optional)" htmlFor="message">
        <Textarea id="message" name="message" rows={3} maxLength={2000} />
      </Field>
      {/* Honeypot: invisible to people, filled in by bots. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {siteKey && <div ref={captcha.ref} />}
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={state === "sending" || !captcha.ready}>
        {state === "sending" ? "Sending…" : "Request access"}
      </Button>
    </form>
  );
}
