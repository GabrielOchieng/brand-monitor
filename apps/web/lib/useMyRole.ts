"use client";

import { useSession, type Role } from "./session";

export type { Role };

// The signed-in user's role in the active organization. null while loading. The API enforces
// roles anyway; this only decides what to show as editable.
export function useMyRole(): Role | null {
  return useSession().role;
}

export function canManage(role: Role | null): boolean {
  return role === "owner" || role === "admin";
}
