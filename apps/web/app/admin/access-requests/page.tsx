"use client";

import { useState } from "react";
import { apiFetch } from "../../../lib/api";
import { AdminShell, AdminTable, ago, td, useAdminData } from "../../../components/admin/AdminShell";
import { Button } from "../../../components/ui/Button";
import { Pill } from "../../../components/threat/atoms";

interface AccessRequestRow {
  id: string;
  name: string;
  email: string;
  organization: string;
  brands: string;
  message: string | null;
  status: "new" | "handled" | "dismissed";
  handledBy: string | null;
  handledAt: string | null;
  createdAt: string;
}

const STATUS: Record<AccessRequestRow["status"], { label: string; tone: string }> = {
  new: { label: "New", tone: "new" },
  handled: { label: "Handled", tone: "resolved" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

// Requests from the public /request-access form. Creating the organization and inviting its owner
// happens on the Organizations tab; mark the request handled here once that's done.
export default function AdminAccessRequestsPage() {
  const { data, blocked, error, reload } = useAdminData<AccessRequestRow[]>("/api/admin/access-requests");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(id: string, status: AccessRequestRow["status"]) {
    setBusy(id);
    setActionError(null);
    try {
      await apiFetch(`/api/admin/access-requests/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Access requests" blocked={blocked} error={error ?? actionError} loading={!data && !error}>
      {data && data.length === 0 ? (
        <p className="text-sm text-subtle">No requests yet. They arrive from the Request access form on the sign-in and landing pages.</p>
      ) : (
        <AdminTable head={["Received", "From", "Organization", "Brands / domains", "Message", "Status", ""]}>
          {data?.map((r) => (
            <tr key={r.id} className="align-top">
              <td className={td} title={new Date(r.createdAt).toLocaleString()}>
                {ago(r.createdAt)}
              </td>
              <td className={td}>
                <div className="text-foreground">{r.name}</div>
                <a href={`mailto:${r.email}?subject=${encodeURIComponent("Your Brand Monitor access request")}`} className="text-xs text-primary hover:underline">
                  {r.email}
                </a>
              </td>
              <td className="px-3.5 py-2.5 text-foreground">{r.organization}</td>
              <td className="max-w-55 px-3.5 py-2.5 text-muted-foreground wrap-break-word">{r.brands}</td>
              <td className="max-w-70 whitespace-pre-wrap px-3.5 py-2.5 text-xs text-muted-foreground wrap-break-word">{r.message ?? "—"}</td>
              <td className={td}>
                <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                {r.handledBy && <div className="mt-1 text-[11px] text-subtle">{r.handledBy}</div>}
              </td>
              <td className={td}>
                <div className="flex gap-1.5">
                  {r.status === "new" ? (
                    <>
                      <Button size="sm" disabled={busy === r.id} onClick={() => setStatus(r.id, "handled")}>
                        Mark handled
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => setStatus(r.id, "dismissed")}>
                        Dismiss
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => setStatus(r.id, "new")}>
                      Reopen
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </AdminTable>
      )}
    </AdminShell>
  );
}
