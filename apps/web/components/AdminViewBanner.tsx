"use client";

import { useState } from "react";
import { apiFetch } from "../lib/api";
import { useSession } from "../lib/session";

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
    <div className="bg-ink text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6">
        <span>
          Viewing <span className="font-semibold">{view.name}</span> as platform admin. Read-only: nothing here can be changed.
        </span>
        <button onClick={exit} disabled={busy} className="rounded-md bg-white/15 px-3 py-1 font-medium hover:bg-white/25">
          {busy ? "Leaving…" : "Exit view"}
        </button>
      </div>
    </div>
  );
}
