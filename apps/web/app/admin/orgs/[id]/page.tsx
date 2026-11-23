"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { apiFetch } from "../../../../lib/api";
import { AdminShell, AdminTable, ago, day, td, useAdminData } from "../../../../components/admin/AdminShell";

const ROLES = ["owner", "admin", "analyst", "viewer"] as const;

interface OrgDetail {
  org: { id: string; name: string; createdAt: string };
  members: Array<{
    userId: string;
    email: string;
    name: string | null;
    role: string;
    joinedAt: string;
    totpEnabled: boolean;
    hasPassword: boolean;
    googleLinked: boolean;
    lastActiveAt: string | null;
  }>;
  brands: Array<{ id: string; name: string; primaryDomain: string; createdAt: string; findings: number; scansThisMonth: number; emailsThisMonth: number; lastScanAt: string | null }>;
  invites: Array<{ id: string; email: string; role: string; createdAt: string; expiresAt: string }>;
}

function InviteForm({ orgId, hasOwner, onDone }: { orgId: string; hasOwner: boolean; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>(hasOwner ? "analyst" : "owner");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/api/admin/orgs/${orgId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      setMsg({ ok: true, text: `Invite sent to ${email}.` });
      setEmail("");
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-2 p-4">
      <div className="label">{hasOwner ? "Invite someone" : "Invite the first owner"}</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input type="email" required placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="field min-w-0 flex-1" aria-label="Email" />
        <select value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])} className="field" aria-label="Role">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r[0].toUpperCase() + r.slice(1)}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "Sending…" : "Send invite"}
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
    </form>
  );
}

function OrgPage() {
  const { id } = useParams<{ id: string }>();
  const created = useSearchParams().get("created") === "1";
  const { data, blocked, error, reload } = useAdminData<OrgDetail>(`/api/admin/orgs/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);

  async function revoke(inviteId: string) {
    setActionError(null);
    try {
      await apiFetch(`/api/admin/orgs/${id}/invites/${inviteId}`, { method: "DELETE" });
      reload();
    } catch (err: any) {
      setActionError(err.message);
    }
  }

  const hasOwner = !!data?.members.some((m) => m.role === "owner");

  return (
    <AdminShell title={data?.org.name ?? "Organization"} blocked={blocked} error={error ?? actionError} loading={!data && !error}>
      {data && (
        <>
          <Link href="/admin" className="text-sm text-ink-subtle hover:text-ink">
            ← All organizations
          </Link>
          {created && !hasOwner && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Organization created. Invite its first owner below.</p>
          )}
          <InviteForm orgId={id} hasOwner={hasOwner} onDone={reload} />

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-ink">Members ({data.members.length})</h2>
            {data.members.length === 0 ? (
              <p className="text-sm text-ink-subtle">No members yet.</p>
            ) : (
              <AdminTable head={["Email", "Role", "Sign-in", "2FA", "Last active", "Joined"]}>
                {data.members.map((m) => (
                  <tr key={m.userId}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink">
                      {m.email}
                      {m.name && <span className="ml-2 text-xs text-ink-subtle">{m.name}</span>}
                    </td>
                    <td className={`${td} capitalize`}>{m.role}</td>
                    <td className={td}>{[m.hasPassword && "password", m.googleLinked && "Google"].filter(Boolean).join(" + ") || "not set up yet"}</td>
                    <td className={td}>{m.totpEnabled ? "on" : "off"}</td>
                    <td className={td}>{ago(m.lastActiveAt)}</td>
                    <td className={td}>{day(m.joinedAt)}</td>
                  </tr>
                ))}
              </AdminTable>
            )}
          </section>

          {data.invites.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold text-ink">Pending invites</h2>
              <AdminTable head={["Email", "Role", "Expires", ""]}>
                {data.invites.map((i) => (
                  <tr key={i.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink">{i.email}</td>
                    <td className={`${td} capitalize`}>{i.role}</td>
                    <td className={td}>{day(i.expiresAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button className="btn-ghost text-xs" onClick={() => revoke(i.id)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </AdminTable>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-ink">Brands ({data.brands.length})</h2>
            {data.brands.length === 0 ? (
              <p className="text-sm text-ink-subtle">No brands yet.</p>
            ) : (
              <AdminTable head={["Brand", "Domain", "Findings", "Scans this month", "Emails this month", "Last scan", "Created"]}>
                {data.brands.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink">{b.name}</td>
                    <td className={td}>{b.primaryDomain}</td>
                    <td className={td}>{b.findings.toLocaleString()}</td>
                    <td className={td}>{b.scansThisMonth.toLocaleString()}</td>
                    <td className={td}>{b.emailsThisMonth}</td>
                    <td className={td}>{ago(b.lastScanAt)}</td>
                    <td className={td}>{day(b.createdAt)}</td>
                  </tr>
                ))}
              </AdminTable>
            )}
          </section>
          <p className="text-xs text-ink-subtle">Created {day(data.org.createdAt)} · {data.org.id}</p>
        </>
      )}
    </AdminShell>
  );
}

export default function AdminOrgPage() {
  return (
    <Suspense fallback={null}>
      <OrgPage />
    </Suspense>
  );
}
