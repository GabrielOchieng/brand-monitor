"use client";

import { useEffect, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { apiFetch } from "./api";

export type Role = "owner" | "admin" | "analyst" | "viewer";

// The signed-in user's role in this organization (our own memberships table, not Clerk).
// null while loading. The API enforces roles anyway; this only decides what to show as
// editable.
export function useMyRole(): Role | null {
  const { getToken, orgId } = useAuth();
  const { user } = useUser();
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    if (!orgId || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const members = await apiFetch<Array<{ userId: string; role: Role }>>("/api/organization/members", await getToken());
        if (!cancelled) setRole(members.find((m) => m.userId === user.id)?.role ?? "viewer");
      } catch {
        if (!cancelled) setRole("viewer");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, user, getToken]);

  return role;
}

export function canManage(role: Role | null): boolean {
  return role === "owner" || role === "admin";
}
