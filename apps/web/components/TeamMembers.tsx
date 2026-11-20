"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";
import { LoadingRegion, SkeletonList } from "./Skeleton";

// Mirrors apps/api/src/lib/auth.ts's VALID_ROLES -- no shared package export exists for
// this (unlike TakedownStatusSchema), since role lives purely in the API's own Membership
// table, not a type either side needs to agree on structurally.
const ROLES = ["owner", "admin", "analyst", "viewer"] as const;

interface Member {
  userId: string;
  email: string;
  role: (typeof ROLES)[number];
}

export function TeamMembers() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const data = await apiFetch<Member[]>("/api/organization/members", token);
    setMembers(data);
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const self = members.find((m) => m.userId === user?.id);
  const isOwner = self?.role === "owner";

  // A role change is closer to a compliance/access-control record than a UI preference
  // (same reasoning TakedownTracker.tsx already documents for its own status select) --
  // revert to the prior value on a failed save rather than leaving a stale-looking-correct
  // one on screen.
  async function handleRoleChange(userId: string, previousRole: Member["role"], nextRole: string) {
    setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role: nextRole as Member["role"] } : m)));
    setError(null);
    try {
      const token = await getToken();
      await apiFetch(`/api/organization/members/${userId}`, token, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
    } catch (err: any) {
      setError(err.message);
      setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role: previousRole } : m)));
    }
  }

  if (loading)
    return (
      <LoadingRegion label="Loading team">
        <SkeletonList rows={3} lines={0} />
      </LoadingRegion>
    );

  return (
    <div className="divide-y divide-line">
      {members.map((m) => (
        <div key={m.userId} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold uppercase text-brand">{m.email.slice(0, 1)}</span>
            <span className="truncate text-sm text-ink">{m.email}</span>
            {m.userId === user?.id && <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle">You</span>}
          </div>
          {isOwner && m.userId !== user?.id ? (
            <select
              value={m.role}
              onChange={(e) => handleRoleChange(m.userId, m.role, e.target.value)}
              className="field-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r[0].toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm capitalize text-ink-subtle">{m.role}</span>
          )}
        </div>
      ))}
      {members.length === 0 && <div className="py-8 text-center text-sm text-ink-subtle">No teammates yet.</div>}
      {error && <p className="pt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
