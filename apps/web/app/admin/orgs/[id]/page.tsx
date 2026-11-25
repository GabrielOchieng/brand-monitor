"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../../../lib/api";
import { AdminShell, AdminTable, MonitoringStatus, ago, day, td, useAdminData } from "../../../../components/admin/AdminShell";
import { useConfirmText } from "../../../../components/ui/Confirm";
import { AutoTakedownAdmin } from "../../../../components/admin/AutoTakedownAdmin";

const ROLES = ["owner", "admin", "analyst", "viewer"] as const;

interface OrgDetail {
  org: { id: string; name: string; createdAt: string; pausedAt: string | null; pausedBy: string | null };
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
  brands: Array<{ id: string; name: string; primaryDomain: string; createdAt: string; pausedAt: string | null; pausedBy: string | null; findings: number; scansThisMonth: number; emailsThisMonth: number; tavilyThisMonth: number; lastScanAt: string | null }>;
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
      {msg && <p className={`text-sm ${msg.ok ? "text-ok" : "text-sev-critical"}`}>{msg.text}</p>}
    </form>
  );
}

// Typing the exact name is the confirmation; the API checks it too.
function DeleteOrg({ org, brands, findings }: { org: { id: string; name: string }; brands: number; findings: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/orgs/${org.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: typed }),
      });
      router.push("/admin");
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-sev-critical/40 bg-sev-critical/5 p-4">
      <h2 className="text-base font-semibold text-sev-critical">Delete organization</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Permanently deletes {org.name}: {brands} brand{brands === 1 ? "" : "s"}, {findings.toLocaleString()} finding{findings === 1 ? "" : "s"}, every scan,
        report and setting, and its screenshots. Members who belong to no other organization are deleted too. This can't be undone.
      </p>
      {!open ? (
        <button className="btn-danger mt-3 border border-sev-critical/40 px-3.5 py-2" onClick={() => setOpen(true)}>
          Delete organization…
        </button>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-2 sm:max-w-md">
          <label htmlFor="confirm-org-name" className="block text-sm text-ink">
            Type <span className="font-semibold">{org.name}</span> to confirm
          </label>
          <input id="confirm-org-name" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className="field w-full" />
          {error && <p className="text-sm text-sev-critical">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || typed.trim() !== org.name.trim()} className="btn bg-sev-critical px-3.5 py-2 text-white hover:bg-sev-critical">
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function OrgPage() {
  const confirm = useConfirmText();
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
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Opens the normal app for this org as a viewer; the API refuses every change meanwhile.
  async function startView() {
    setActionError(null);
    setBusy("view");
    try {
      await apiFetch(`/api/admin/orgs/${id}/view`, { method: "POST" });
      window.location.assign("/dashboard");
    } catch (err: any) {
      setActionError(err.message);
      setBusy(null);
    }
  }

  async function removeMember(userId: string, email: string) {
    if (!await confirm(`Remove ${email} from ${data?.org.name}? Their assignments here are cleared. Their account stays.`)) return;
    setActionError(null);
    setNotice(null);
    setBusy(userId);
    try {
      await apiFetch(`/api/admin/orgs/${id}/members/${userId}`, { method: "DELETE" });
      setNotice(`${email} was removed from ${data?.org.name}.`);
      await reload();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function setPaused(kind: "orgs" | "brands", targetId: string, name: string, pause: boolean) {
    const what = kind === "orgs" ? `all monitoring for ${name}` : `monitoring of ${name}`;
    if (pause && !await confirm(`Pause ${what}? Data is kept; nothing new is discovered, scanned or searched until you resume.`)) return;
    setActionError(null);
    setBusy(targetId);
    try {
      await apiFetch(`/api/admin/${kind}/${targetId}/${pause ? "pause" : "resume"}`, { method: "POST" });
      await reload();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title={data?.org.name ?? "Organization"} blocked={blocked} error={error ?? actionError} loading={!data && !error}>
      {data && (
        <>
          <Link href="/admin" className="text-sm text-ink-subtle hover:text-ink">
            ← All organizations
          </Link>
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-ink">Monitoring</span>
              <MonitoringStatus pausedAt={data.org.pausedAt} />
              {data.org.pausedAt && (
                <span className="text-xs text-ink-subtle">
                  since {day(data.org.pausedAt)}
                  {data.org.pausedBy ? ` by ${data.org.pausedBy}` : ""}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={busy === "view"} onClick={startView}>
              View read-only
            </button>
            <button
              className={data.org.pausedAt ? "btn-primary" : "btn-secondary"}
              disabled={busy === data.org.id}
              onClick={() => setPaused("orgs", data.org.id, data.org.name, !data.org.pausedAt)}
            >
              {data.org.pausedAt ? "Resume organization" : "Pause organization"}
            </button>
            </div>
          </div>
          {notice && <p role="status" className="text-sm text-ok">{notice}</p>}
          {created && !hasOwner && (
            <p className="rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">Organization created. Invite its first owner below.</p>
          )}
          <InviteForm orgId={id} hasOwner={hasOwner} onDone={reload} />

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-ink">Members ({data.members.length})</h2>
            {data.members.length === 0 ? (
              <p className="text-sm text-ink-subtle">No members yet.</p>
            ) : (
              <AdminTable head={["Email", "Role", "Sign-in", "2FA", "Last active", "Joined", ""]}>
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
                    <td className="px-4 py-2.5 text-right">
                      <button className="btn-danger text-xs" disabled={busy === m.userId} onClick={() => removeMember(m.userId, m.email)}>
                        Remove
                      </button>
                    </td>
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
              <AdminTable head={["Brand", "Domain", "Monitoring", "Findings", "Scans this month", "Emails this month", "Tavily this month", "Last scan", "Created", ""]}>
                {data.brands.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink">{b.name}</td>
                    <td className={td}>{b.primaryDomain}</td>
                    <td className={td}>
                      <MonitoringStatus pausedAt={data.org.pausedAt ?? b.pausedAt} />
                    </td>
                    <td className={td}>{b.findings.toLocaleString()}</td>
                    <td className={td}>{b.scansThisMonth.toLocaleString()}</td>
                    <td className={td}>{b.emailsThisMonth}</td>
                    <td className={td}>{b.tavilyThisMonth}</td>
                    <td className={td}>{ago(b.lastScanAt)}</td>
                    <td className={td}>{day(b.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {data.org.pausedAt ? (
                        <span className="text-xs text-ink-subtle">org paused</span>
                      ) : (
                        <button className="btn-ghost text-xs" disabled={busy === b.id} onClick={() => setPaused("brands", b.id, b.name, !b.pausedAt)}>
                          {b.pausedAt ? "Resume" : "Pause"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </AdminTable>
            )}
          </section>
          <AutoTakedownAdmin orgId={data.org.id} orgName={data.org.name} />
          <p className="text-xs text-ink-subtle">Created {day(data.org.createdAt)} · {data.org.id}</p>
          <DeleteOrg org={data.org} brands={data.brands.length} findings={data.brands.reduce((a, b) => a + b.findings, 0)} />
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
