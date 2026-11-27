"use client";

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string;
      reset: (id?: string) => void;
    };
  }
}

// Cloudflare Turnstile for the public forms, only when a site key is configured; otherwise the
// API skips the check too (honeypot + rate limit only). Put `ref` on an empty div.
export function useTurnstile(siteKey: string): { ref: React.RefObject<HTMLDivElement | null>; token: string; ready: boolean; reset: () => void } {
  const [token, setToken] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!siteKey) return;
    const render = () => {
      if (ref.current && window.turnstile && widgetId.current === undefined) {
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: setToken,
          "expired-callback": () => setToken(""),
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

  const reset = useCallback(() => {
    if (window.turnstile && widgetId.current !== undefined) window.turnstile.reset(widgetId.current);
    setToken("");
  }, []);

  return { ref, token, ready: !siteKey || Boolean(token), reset };
}
