"use client";

import { useState } from "react";
import { apiFetch } from "../../../lib/api";
import { AdminShell, useAdminData } from "../../../components/admin/AdminShell";
import { useConfirmText } from "../../../components/ui/Confirm";
import { ContactForm, ContactTable, type ContactRule } from "../../../components/ContactBook";

// The platform contact book: where reports to a registrar / host / TLD go, for every org (an org's
// own entry wins over one that matches the same way). Every change is in the audit log.
export default function AdminContactsPage() {
  const confirm = useConfirmText();
  const { data, blocked, error, reload } = useAdminData<ContactRule[]>("/api/admin/contacts");
  const [editing, setEditing] = useState<ContactRule | "new" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function remove(c: ContactRule) {
    if (!await confirm("Delete this entry for every organization?")) return;
    setActionError(null);
    try {
      await apiFetch(`/api/admin/contacts/${c.id}`, { method: "DELETE" });
      await reload();
    } catch (err: any) {
      setActionError(err.message);
    }
  }

  return (
    <AdminShell title="Contact book" blocked={blocked} error={error ?? actionError} loading={!data && !error}>
      {data && (
        <>
          <p className="max-w-2xl text-sm text-ink-subtle">
            Shared by every organization. Use it for what&apos;s true of a provider for everyone: a registrar that only takes web forms, a better abuse address than the registry
            record gives, the blocklist forms. Organizations can override it in their own contact book.
          </p>
          <div className="card p-5">
            <ContactTable contacts={data} editable onEdit={(c) => setEditing(c)} onDelete={remove} />
            {editing === null ? (
              <button className="btn-secondary mt-3" onClick={() => setEditing("new")}>
                Add an entry
              </button>
            ) : (
              <div className="mt-3">
                <ContactForm endpoint="/api/admin/contacts" existing={editing === "new" ? null : editing} onDone={() => (setEditing(null), reload())} onCancel={() => setEditing(null)} />
              </div>
            )}
          </div>
        </>
      )}
    </AdminShell>
  );
}
