"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";

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

  if (loading) return <p className="mt-6 text-sm text-ink-subtle">Loading…</p>;

  return (
    <div className="card mt-6 divide-y divide-line">
      {members.map((m) => (
        <div key={m.userId} className="flex items-center justify-between gap-4 px-4 py-3">
          <span className="text-sm text-ink">{m.email}</span>
          {isOwner && m.userId !== user?.id ? (
            <select
              value={m.role}
              onChange={(e) => handleRoleChange(m.userId, m.role, e.target.value)}
              className="field-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm capitalize text-ink-subtle">{m.role}</span>
          )}
        </div>
      ))}
      {members.length === 0 && <div className="px-4 py-10 text-center text-sm text-ink-subtle">No teammates yet.</div>}
      {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
