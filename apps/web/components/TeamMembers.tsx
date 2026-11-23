"use client";

import { useEffect, useState, useCallback, type FormEvent } from "react";
import { apiFetch } from "../lib/api";
import { useSession } from "../lib/session";
import { LoadingRegion, SkeletonList } from "./Skeleton";

// Mirrors apps/api/src/lib/auth.ts's VALID_ROLES.
const ROLES = ["owner", "admin", "analyst", "viewer"] as const;
type Role = (typeof ROLES)[number];

const ROLE_HELP: Record<Role, string> = {
  owner: "everything, including roles and removing people",
  admin: "brands, settings and invites",
  analyst: "works findings and reports",
  viewer: "read only",
};

interface Member {
  userId: string;
  email: string;
  role: Role;
}

interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

const capitalize = (r: string) => r[0].toUpperCase() + r.slice(1);

export function TeamMembers() {
  const { userId, role: myRole } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isOwner = myRole === "owner";
  const canInvite = myRole === "owner" || myRole === "admin";

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      apiFetch<Member[]>("/api/organization/members"),
      canInvite ? apiFetch<Invite[]>("/api/organization/invites") : Promise.resolve([]),
    ]);
    setMembers(m);
    setInvites(i);
    setLoading(false);
  }, [canInvite]);

  useEffect(() => {
    if (!myRole) return;
    load().catch(() => setLoading(false));
  }, [load, myRole]);

  // A role change is closer to an access-control record than a UI preference -- revert to
  // the prior value on a failed save rather than leaving a stale-looking-correct one on screen.
  async function handleRoleChange(memberId: string, previousRole: Role, nextRole: string) {
    setMembers((prev) => prev.map((m) => (m.userId === memberId ? { ...m, role: nextRole as Role } : m)));
    setError(null);
    try {
      await apiFetch(`/api/organization/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
    } catch (err: any) {
      setError(err.message);
      setMembers((prev) => prev.map((m) => (m.userId === memberId ? { ...m, role: previousRole } : m)));
    }
  }

  async function handleRemove(member: Member) {
    if (!window.confirm(`Remove ${member.email} from this organization? Their findings assignments are cleared.`)) return;
    setError(null);
    try {
      await apiFetch(`/api/organization/members/${member.userId}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleRevoke(invite: Invite) {
    setError(null);
    try {
      await apiFetch(`/api/organization/invites/${invite.id}`, { method: "DELETE" });
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading)
    return (
      <LoadingRegion label="Loading team">
        <SkeletonList rows={3} lines={0} />
      </LoadingRegion>
    );

  return (
    <div className="space-y-6">
      {canInvite && <InviteForm isOwner={isOwner} onInvited={() => load().catch(() => {})} />}

      <div className="divide-y divide-line">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold uppercase text-brand">{m.email.slice(0, 1)}</span>
              <span className="truncate text-sm text-ink">{m.email}</span>
              {m.userId === userId && <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle">You</span>}
            </div>
            {isOwner && m.userId !== userId ? (
              <div className="flex shrink-0 items-center gap-2">
                <select value={m.role} onChange={(e) => handleRoleChange(m.userId, m.role, e.target.value)} className="field-sm" aria-label={`Role for ${m.email}`}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {capitalize(r)}
                    </option>
                  ))}
                </select>
                <button onClick={() => handleRemove(m)} className="btn-danger text-xs">
                  Remove
                </button>
              </div>
            ) : (
              <span className="text-sm capitalize text-ink-subtle">{m.role}</span>
            )}
          </div>
        ))}
        {members.length === 0 && <div className="py-8 text-center text-sm text-ink-subtle">No teammates yet.</div>}
      </div>

      {canInvite && invites.length > 0 && (
        <div>
          <div className="label mb-2">Pending invites</div>
          <div className="divide-y divide-line">
            {invites.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink">{i.email}</div>
                  <div className="text-xs text-ink-subtle">
                    {capitalize(i.role)}, expires {new Date(i.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <button onClick={() => handleRevoke(i)} className="btn-ghost shrink-0 text-xs">
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function InviteForm({ isOwner, onInvited }: { isOwner: boolean; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("analyst");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Only owners can invite owners (the API enforces it too).
  const roles = isOwner ? ROLES : ROLES.filter((r) => r !== "owner");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch("/api/organization/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      setMessage({ ok: true, text: `Invite sent to ${email}. The link expires in 7 days.` });
      setEmail("");
      onInvited();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-line bg-elevated/40 p-4">
      <div className="label mb-2">Invite someone</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input type="email" required placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="field min-w-0 flex-1" aria-label="Email to invite" />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="field" aria-label="Role">
          {roles.map((r) => (
            <option key={r} value={r}>
              {capitalize(r)}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Sending…" : "Send invite"}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-subtle">
        {capitalize(role)}: {ROLE_HELP[role]}.
      </p>
      {message && <p className={`mt-2 text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>{message.text}</p>}
    </form>
  );
}
