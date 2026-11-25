"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Mail, UserMinus } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useSession } from "../lib/session";
import { LoadingRegion, SkeletonList } from "./Skeleton";
import { Panel, PanelBody, PanelHeader } from "./ui/Panel";
import { Button } from "./ui/Button";
import { Input, Select } from "./ui/Field";
import { Banner } from "./ui/Banner";
import { useConfirm } from "./ui/Confirm";
import { useToast } from "./ui/Toast";
import { Pill } from "./threat/atoms";

// Mirrors apps/api/src/lib/auth.ts's VALID_ROLES.
const ROLES = ["owner", "admin", "analyst", "viewer"] as const;
type Role = (typeof ROLES)[number];

const ROLE_HELP: Record<Role, string> = {
  owner: "everything, including roles, removing people and automatic reporting",
  admin: "brands, settings and invites",
  analyst: "triages threats and sends takedown reports",
  viewer: "can only look",
};

interface Member {
  userId: string;
  email: string;
  name?: string | null;
  role: Role;
}

interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

const capitalize = (r: string): string => r[0].toUpperCase() + r.slice(1);

// Who can see and act on the organization's threats: invites, roles, removal.
export function TeamMembers() {
  const { userId, role: myRole, me } = useSession();
  const ask = useConfirm();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const readOnly = !!me?.adminView;
  const isOwner = myRole === "owner" && !readOnly;
  const canInvite = (myRole === "owner" || myRole === "admin") && !readOnly;

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([apiFetch<Member[]>("/api/organization/members"), canInvite ? apiFetch<Invite[]>("/api/organization/invites") : Promise.resolve([])]);
    setMembers(m);
    setInvites(i);
    setLoading(false);
  }, [canInvite]);

  useEffect(() => {
    if (!myRole) return;
    load().catch(() => setLoading(false));
  }, [load, myRole]);

  // A role change is an access-control record: revert on a failed save rather than leaving a
  // value on screen the server doesn't have.
  async function changeRole(member: Member, next: string) {
    const prev = member.role;
    setMembers((all) => all.map((m) => (m.userId === member.userId ? { ...m, role: next as Role } : m)));
    setError(null);
    try {
      await apiFetch(`/api/organization/members/${member.userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: next }) });
      toast(`${member.name || member.email} is now ${next === "admin" || next === "analyst" || next === "owner" ? "an" : "a"} ${next}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMembers((all) => all.map((m) => (m.userId === member.userId ? { ...m, role: prev } : m)));
    }
  }

  async function remove(member: Member) {
    const ok = await ask({
      title: `Remove ${member.email}?`,
      body: "They lose access to this organization and their threat assignments are cleared. Their account stays.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await apiFetch(`/api/organization/members/${member.userId}`, { method: "DELETE" });
      setMembers((all) => all.filter((m) => m.userId !== member.userId));
      toast(`Removed ${member.email}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function revoke(invite: Invite) {
    setError(null);
    try {
      await apiFetch(`/api/organization/invites/${invite.id}`, { method: "DELETE" });
      setInvites((all) => all.filter((i) => i.id !== invite.id));
      toast(`Invite to ${invite.email} cancelled`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading)
    return (
      <LoadingRegion label="Loading team">
        <SkeletonList rows={3} lines={0} />
      </LoadingRegion>
    );


  return (
    <div className="flex flex-col gap-4">
      {error && <Banner tone="error">{error}</Banner>}
      {canInvite && <InviteForm isOwner={isOwner} onInvited={() => load().catch(() => {})} />}

      <Panel>
        <PanelHeader title="Members" count={members.length} />
        {members.length === 0 ? (
          <p className="p-3.5 text-[13px] text-subtle">No teammates yet.</p>
        ) : (
          <ul>
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-3.5 py-2.5 text-[13px] last:border-b-0">
                <div className="flex min-w-0 flex-1 basis-56 items-center gap-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border-strong bg-raised text-[11px] font-semibold uppercase text-muted-foreground">
                    {(m.name || m.email).slice(0, 1)}
                  </span>
                  <span className="min-w-0">
                    {m.name && <span className="block truncate">{m.name}</span>}
                    <span className="block truncate font-mono text-xs text-subtle">{m.email}</span>
                  </span>
                  {m.userId === userId && <Pill tone="neutral">You</Pill>}
                </div>
                <div className="flex items-center gap-1.5">
                  {isOwner && m.userId !== userId ? (
                    <>
                      <Select value={m.role} onChange={(e) => changeRole(m, e.target.value)} className="h-7 w-auto" aria-label={`Role for ${m.email}`}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {capitalize(r)}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="ghost" onClick={() => remove(m)} aria-label={`Remove ${m.email}`}>
                        <UserMinus />
                        <span className="max-sm:hidden">Remove</span>
                      </Button>
                    </>
                  ) : (
                    <span className="capitalize text-muted-foreground">{m.role}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canInvite && invites.length > 0 && (
        <Panel>
          <PanelHeader title="Pending invites" count={invites.length} />
          <ul>
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 border-b border-border px-3.5 py-2.5 last:border-b-0">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Mail className="size-4 shrink-0 text-subtle" />
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[13px]">{i.email}</div>
                    <div className="text-xs text-subtle">
                      {capitalize(i.role)} · expires {new Date(i.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => revoke(i)}>
                  Cancel invite
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function InviteForm({ isOwner, onInvited }: { isOwner: boolean; onInvited: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("analyst");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only owners can invite owners (the API enforces it too).
  const roles = isOwner ? ROLES : ROLES.filter((r) => r !== "owner");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/organization/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
      toast(`Invite sent to ${email}. The link expires in 7 days.`);
      setEmail("");
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Invite someone" />
      <PanelBody>
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <Input type="email" required mono placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email to invite" className="sm:max-w-xs" />
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role" className="sm:w-36">
            {roles.map((r) => (
              <option key={r} value={r}>
                {capitalize(r)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Sending…" : "Send invite"}
          </Button>
        </form>
        <p className="mt-2 text-xs text-subtle">
          {capitalize(role)}: {ROLE_HELP[role]}.
        </p>
        {error && <p className="mt-2 text-[13px] text-sev-critical">{error}</p>}
      </PanelBody>
    </Panel>
  );
}
