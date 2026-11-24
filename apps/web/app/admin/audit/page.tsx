"use client";

import { AdminShell, AdminTable, td, useAdminData } from "../../../components/admin/AdminShell";

interface AuditRow {
  id: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  "org.create": "Created organization",
  "org.invite_owner": "Invited into organization",
  "org.pause": "Paused organization",
  "org.resume": "Resumed organization",
  "brand.pause": "Paused brand",
  "brand.resume": "Resumed brand",
  "org.delete": "Deleted organization",
  "org.view_start": "Started viewing organization",
  "org.view_end": "Stopped viewing organization",
  "user.sign_out_all": "Signed user out everywhere",
  "user.reset_2fa": "Reset user's 2FA",
  "user.send_password_link": "Sent set-password link",
  "user.remove_from_org": "Removed user from organization",
  "user.delete": "Deleted user",
  "org.auto_takedown_allow": "Allowed automatic takedown reporting",
  "org.auto_takedown_disallow": "Withdrew automatic takedown reporting",
  "platform_contact.create": "Added a contact-book entry",
  "platform_contact.update": "Changed a contact-book entry",
  "platform_contact.delete": "Deleted a contact-book entry",
};

function describe(details: Record<string, unknown> | null): string {
  if (!details) return "";
  return Object.entries(details)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default function AdminAuditPage() {
  const { data, blocked, error } = useAdminData<AuditRow[]>("/api/admin/audit?limit=200");
  return (
    <AdminShell title="Audit log" blocked={blocked} error={error} loading={!data && !error}>
      {data && data.length === 0 ? (
        <p className="text-sm text-ink-subtle">No admin actions yet.</p>
      ) : (
        <AdminTable head={["When", "Admin", "Action", "Target", "Details"]}>
          {data?.map((r) => (
            <tr key={r.id}>
              <td className={td}>{new Date(r.createdAt).toLocaleString()}</td>
              <td className={td}>{r.adminEmail}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-ink">{ACTION_LABELS[r.action] ?? r.action}</td>
              <td className={`${td} font-mono text-xs`}>
                {r.targetType} {r.targetId}
              </td>
              <td className="px-4 py-2.5 text-xs text-ink-muted">{describe(r.details)}</td>
            </tr>
          ))}
        </AdminTable>
      )}
      <p className="text-xs text-ink-subtle">The 200 most recent actions.</p>
    </AdminShell>
  );
}
