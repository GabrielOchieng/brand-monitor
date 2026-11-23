"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError, apiFetch } from "./api";

export type Role = "owner" | "admin" | "analyst" | "viewer";

export interface Me {
  user: { id: string; email: string; name: string | null };
  activeOrgId: string | null;
  organizations: Array<{ id: string; name: string; role: Role }>;
  security: { hasPassword: boolean; totpEnabled: boolean; recoveryCodesLeft: number; googleLinked: boolean };
}

interface SessionValue {
  me: Me | null;
  isLoaded: boolean;
  userId: string | null;
  orgId: string | null;
  role: Role | null;
  // Replaces the session data, e.g. with the body /auth/login or /auth/switch-org returns.
  setMe: (me: Me) => void;
  refresh: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

// Pages that work signed out. middleware.ts sends everything else to /login when there's no
// session cookie at all; this provider handles a cookie that's there but no longer valid.
export const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/invite", "/confirm-email", "/report/"];
export function isPublicPath(pathname: string | null): boolean {
  return !!pathname && PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const publicPage = isPublicPath(pathname);

  const refresh = useCallback(async () => {
    try {
      setMe(await apiFetch<Me>("/auth/me"));
    } catch (err) {
      setMe(null);
      if (err instanceof ApiError && err.status === 401 && !isPublicPath(window.location.pathname)) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      }
    } finally {
      setIsLoaded(true);
    }
  }, [router]);

  useEffect(() => {
    // Public pages don't need the session (and the report form is seen by non-users).
    if (publicPage) {
      setIsLoaded(true);
      return;
    }
    refresh();
  }, [publicPage, refresh]);

  const switchOrg = useCallback(
    async (orgId: string) => {
      const next = await apiFetch<Me>("/auth/switch-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      setMe(next);
      // Full page load: every page (and server-rendered ones) loaded data for the previous org.
      window.location.assign("/dashboard");
    },
    []
  );

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      setMe(null);
      window.location.replace("/login");
    }
  }, []);

  const value = useMemo<SessionValue>(() => {
    const orgId = me?.activeOrgId ?? null;
    return {
      me,
      isLoaded,
      userId: me?.user.id ?? null,
      orgId,
      role: me?.organizations.find((o) => o.id === orgId)?.role ?? null,
      setMe,
      refresh,
      switchOrg,
      signOut,
    };
  }, [me, isLoaded, refresh, switchOrg, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

// Only relative paths, so ?next= can't send someone to another site after signing in.
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}
