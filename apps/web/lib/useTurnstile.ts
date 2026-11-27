"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { turnstileFailureKind, type TurnstileFailure } from "./turnstileErrors";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": (code: string) => void }
      ) => string;
      reset: (id?: string) => void;
    };
  }
}

// Cloudflare Turnstile for the public forms, only when a site key is configured; otherwise the
// API skips the check too (honeypot + rate limit only). Put `ref` on an empty div.
// `failure`: the widget failed, so the form can't be sent; show TurnstileFailed. "config" is our
// setup (e.g. this domain missing from the widget's hostnames), "blocked" the visitor's side (an
// office web filter or an ad blocker blocking challenges.cloudflare.com).
export function useTurnstile(siteKey: string): {
  ref: React.RefObject<HTMLDivElement | null>;
  token: string;
  ready: boolean;
  failure: TurnstileFailure | null;
  reset: () => void;
} {
  const [token, setToken] = useState("");
  const [failure, setFailure] = useState<TurnstileFailure | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!siteKey) return;
    const render = () => {
      if (ref.current && window.turnstile && widgetId.current === undefined) {
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: (t) => {
            setToken(t);
            setFailure(null);
          },
          "expired-callback": () => setToken(""),
          "error-callback": (code) => {
            setToken("");
            setFailure(turnstileFailureKind(code));
          },
        });
      }
    };
    if (window.turnstile) return render();
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    script.onerror = () => setFailure("blocked");
    document.head.appendChild(script);
  }, [siteKey]);

  const reset = useCallback(() => {
    if (window.turnstile && widgetId.current !== undefined) window.turnstile.reset(widgetId.current);
    setToken("");
  }, []);

  return { ref, token, ready: !siteKey || Boolean(token), failure, reset };
}
