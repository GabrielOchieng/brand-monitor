"use client";

import { useState } from "react";
import { useConfirmText } from "../ui/Confirm";
import { apiFetch } from "../../lib/api";

interface Target {
  id: string;
  email: string;
  totpEnabled: boolean;
  platformRole: string | null;
}

type ActionKey = "sign-out" | "password-link" | "reset-2fa" | "delete";

// Per-user admin actions. A native <select> rather than a popover: the tables scroll
// horizontally on phones, which would clip a popover. Every action asks for confirmation.
export function UserActions({ user, onDone }: { user: Target; onDone: (message: { ok: boolean; text: string }) => void }) {
  const confirm = useConfirmText();
  const [busy, setBusy] = useState(false);

  const actions: Record<ActionKey, { label: string; confirm: string; path: string; method: "POST" | "DELETE"; success: string }> = {
    "sign-out": {
      label: "Sign out everywhere",
      confirm: `Sign ${user.email} out on every device?`,
      path: `/api/admin/users/${user.id}/sign-out`,
      method: "POST",
      success: `${user.email} was signed out everywhere.`,
    },
    "password-link": {
      label: "Send set-password link",
      confirm: `Email ${user.email} a link to set a new password? Their current password keeps working until they use it.`,
      path: `/api/admin/users/${user.id}/password-link`,
      method: "POST",
      success: `Set-password link sent to ${user.email}.`,
    },
    "reset-2fa": {
      label: "Reset two-factor sign-in",
      confirm: `Turn off two-factor sign-in for ${user.email}? Only after confirming, outside the app, that they really lost their phone and recovery codes. They're also signed out everywhere.`,
      path: `/api/admin/users/${user.id}/reset-2fa`,
      method: "POST",
      success: `Two-factor sign-in turned off for ${user.email}.`,
    },
    delete: {
      label: "Delete user…",
      confirm: `Delete ${user.email}? They lose access to every organization; their notes stay without an author. This can't be undone.`,
      path: `/api/admin/users/${user.id}`,
      method: "DELETE",
      success: `${user.email} was deleted.`,
    },
  };
  const available: ActionKey[] = ["sign-out", "password-link", ...(user.totpEnabled ? (["reset-2fa"] as const) : []), ...(user.platformRole ? [] : (["delete"] as const))];

  async function run(key: ActionKey) {
    const a = actions[key];
    if (!await confirm(a.confirm)) return;
    setBusy(true);
    try {
      await apiFetch(a.path, { method: a.method });
      onDone({ ok: true, text: a.success });
    } catch (err: any) {
      onDone({ ok: false, text: `${user.email}: ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className="field-sm"
      aria-label={`Actions for ${user.email}`}
      disabled={busy}
      value=""
      onChange={(e) => {
        const key = e.target.value as ActionKey;
        e.target.value = "";
        if (key) run(key);
      }}
    >
      <option value="">{busy ? "Working…" : "Actions…"}</option>
      {available.map((k) => (
        <option key={k} value={k}>
          {actions[k].label}
        </option>
      ))}
    </select>
  );
}
