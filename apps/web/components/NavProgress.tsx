"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// A thin bar across the top of the window while a navigation is in flight. loading.tsx
// skeletons cover opening a new page; this covers what they don't: changing filters,
// sorting or paging on the same page (same route, new search params), where Next.js keeps
// the old page on screen until the new one is ready and nothing showed that anything was
// happening.
//
// The App Router has no navigation events, so it starts on a click on an internal link or
// a GET form submit (the threat-feed filters) and finishes when the URL changes.
export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [width, setWidth] = useState(0);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }

  useEffect(() => {
    function start(target: URL) {
      if (target.origin !== window.location.origin) return;
      if (target.pathname === window.location.pathname && target.search === window.location.search) return;
      clearTimers();
      setState("loading");
      setWidth(8);
      // Creeps towards 90% and waits there for the real finish.
      [[100, 30], [400, 55], [1200, 72], [3000, 85], [6000, 90]].forEach(([ms, w]) => {
        timers.current.push(window.setTimeout(() => setWidth(w), ms));
      });
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a || !a.href || a.target === "_blank" || a.hasAttribute("download")) return;
      start(new URL(a.href));
    }

    function onSubmit(e: SubmitEvent) {
      const form = e.target as HTMLFormElement;
      if (e.defaultPrevented || (form.method || "get").toLowerCase() !== "get" || !form.action) return;
      const url = new URL(form.action);
      url.search = new URLSearchParams(new FormData(form) as unknown as Record<string, string>).toString();
      start(url);
    }

    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  // The URL changed: the new page is on screen.
  useEffect(() => {
    if (state !== "loading") return;
    clearTimers();
    setWidth(100);
    setState("done");
    timers.current.push(window.setTimeout(() => setState("idle"), 300));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  useEffect(() => clearTimers, []);

  if (state === "idle") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5" aria-hidden>
      <div
        className={`h-full bg-primary shadow-[0_0_8px_rgba(91,79,224,0.6)] transition-[width,opacity] duration-300 ease-out ${state === "done" ? "opacity-0" : "opacity-100"}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
