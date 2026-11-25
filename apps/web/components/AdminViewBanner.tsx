"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useSession } from "../lib/session";
import { Button } from "./ui/Button";

// Always on top while a platform admin is viewing an org read-only, with the way out.
export function AdminViewBanner() {
  const { me } = useSession();
  const [busy, setBusy] = useState(false);
  if (!me?.adminView) return null;
  const view = me.adminView;

  async function exit() {
    setBusy(true);
    try {
      await apiFetch("/auth/admin-view/exit", { method: "POST" });
    } finally {
      window.location.assign(`/admin/orgs/${view.orgId}`);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/40 bg-primary-soft px-4 py-2 text-[13px] lg:px-6">
      <span className="flex items-center gap-2">
        <Eye className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
          Viewing <span className="font-semibold">{view.name}</span> as platform admin. Read-only: nothing here can be changed.
        </span>
      </span>
      <Button size="sm" onClick={exit} disabled={busy}>
        {busy ? "Leaving…" : "Exit view"}
      </Button>
    </div>
  );
}
