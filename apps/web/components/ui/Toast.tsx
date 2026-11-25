"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

type Toast = { id: number; message: string; tone: "default" | "error"; action?: { label: string; onClick: () => void } };
type ToastInput = Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] };

const ToastContext = createContext<((t: ToastInput | string) => void) | null>(null);

// One toast at a time, bottom centre, above the mobile bottom bar. It confirms what just happened
// ("Dismissed acmeair-help.net") and can offer one action, usually Undo.
export function Toaster({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((t: ToastInput | string) => {
    const next: Toast = typeof t === "string" ? { id: Date.now(), message: t, tone: "default" } : { id: Date.now(), tone: "default", ...t };
    setToast(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), next.tone === "error" ? 6000 : 3500);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(16px+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 max-lg:bottom-[calc(72px+env(safe-area-inset-bottom))]">
        {toast && (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex max-w-full items-center gap-3 rounded-md px-3.5 py-2 text-[13px] shadow-popover animate-in fade-in-0 slide-in-from-bottom-2",
              toast.tone === "error" ? "bg-sev-critical text-white" : "bg-foreground text-background"
            )}
          >
            <span className="min-w-0">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="shrink-0 font-semibold underline underline-offset-2"
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (t: ToastInput | string) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <Toaster>");
  return show;
}
