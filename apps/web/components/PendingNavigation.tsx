"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// For server-rendered pages whose filters, sorting and paging only change the URL's search
// params (the threat feed). A plain link or GET form there either reloads the whole page or
// leaves the old results on screen with no sign anything is happening. Navigating inside a
// transition instead tells us while the new results are loading, so the results area can
// show a skeleton until they arrive.

const PendingContext = createContext<{ isPending: boolean; navigate: (href: string) => void }>({
  isPending: false,
  navigate: () => {},
});

export function PendingProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const navigate = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  return <PendingContext.Provider value={{ isPending, navigate }}>{children}</PendingContext.Provider>;
}

export function usePendingNavigation() {
  return useContext(PendingContext);
}

// Shows `fallback` in place of the children while a navigation is loading.
export function PendingSwap({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  const { isPending } = usePendingNavigation();
  return <>{isPending ? fallback : children}</>;
}

// A real link (open-in-new-tab and copy-link still work) that navigates inside the transition.
export function PendingLink({ href, className, children, disabled, ...rest }: { href: string; className?: string; children: ReactNode; disabled?: boolean; "aria-label"?: string }) {
  const { navigate } = usePendingNavigation();
  return (
    <a
      href={href}
      aria-disabled={disabled || undefined}
      className={`${className ?? ""} ${disabled ? "pointer-events-none opacity-40" : ""}`}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
