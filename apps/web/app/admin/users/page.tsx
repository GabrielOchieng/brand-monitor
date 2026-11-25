"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AdminShell, AdminTable, ago, day, td, useAdminData } from "../../../components/admin/AdminShell";
import { UserActions } from "../../../components/admin/UserActions";
import { useSession } from "../../../lib/session";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  platformRole: string | null;
  createdAt: string;
  hasPassword: boolean;
  totpEnabled: boolean;
  googleLinked: boolean;
  lastActiveAt: string | null;
  orgs: Array<{ id: string; name: string; role: string }>;
}

export default function AdminUsersPage() {
  const { data, blocked, error, reload } = useAdminData<AdminUser[]>("/api/admin/users");
  const { userId } = useSession();
  const [q, setQ] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!data || !term) return data ?? [];
    return data.filter((u) => u.email.includes(term) || u.name?.toLowerCase().includes(term) || u.orgs.some((o) => o.name.toLowerCase().includes(term)));
  }, [data, q]);

  return (
    <AdminShell title="Users" blocked={blocked} error={error} loading={!data && !error}>
      <input type="search" placeholder="Search email, name or organization" value={q} onChange={(e) => setQ(e.target.value)} className="field w-full sm:max-w-sm" aria-label="Search users" />
      {message && <p role="status" className={`text-sm ${message.ok ? "text-ok" : "text-sev-critical"}`}>{message.text}</p>}
      <AdminTable head={["Email", "Organizations", "Sign-in", "2FA", "Last active", "Created", ""]}>
        {rows.map((u) => (
          <tr key={u.id}>
            <td className="whitespace-nowrap px-4 py-2.5 text-foreground">
              {u.email}
              {u.platformRole && <span className="ml-2 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">platform {u.platformRole}</span>}
              {u.name && <div className="text-xs text-subtle">{u.name}</div>}
            </td>
            <td className="px-4 py-2.5 text-muted-foreground">
              {u.orgs.length === 0
                ? "none"
                : u.orgs.map((o, i) => (
                    <span key={o.id}>
                      {i > 0 && ", "}
                      <Link href={`/admin/orgs/${o.id}`} className="hover:text-primary">
                        {o.name}
                      </Link>{" "}
                      <span className="text-xs text-subtle">({o.role})</span>
                    </span>
                  ))}
            </td>
            <td className={td}>{[u.hasPassword && "password", u.googleLinked && "Google"].filter(Boolean).join(" + ") || "not set up yet"}</td>
            <td className={td}>{u.totpEnabled ? "on" : "off"}</td>
            <td className={td}>{ago(u.lastActiveAt)}</td>
            <td className={td}>{day(u.createdAt)}</td>
            <td className="px-4 py-2.5 text-right">
              {u.id === userId ? (
                <span className="text-xs text-subtle">you</span>
              ) : (
                <UserActions
                  user={u}
                  onDone={(m) => {
                    setMessage(m);
                    reload();
                  }}
                />
              )}
            </td>
          </tr>
        ))}
      </AdminTable>
      <p className="text-xs text-subtle">To remove someone from one organization only, use that organization's page. Platform admins can't be deleted here: revoke the role with the script first.</p>
    </AdminShell>
  );
}
