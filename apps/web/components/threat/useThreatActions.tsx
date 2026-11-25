"use client";

import { useCallback } from "react";
import Link from "next/link";
import { Check, Send, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useSession } from "../../lib/session";
import { statusLabel } from "../../lib/format";
import { Button, Kbd } from "../ui/Button";
import { useToast } from "../ui/Toast";

const json = { "Content-Type": "application/json" };

// Who may change a threat: analysts and up, never in a platform admin's read-only view.
export function useCanAct(): boolean {
  const { me, role } = useSession();
  return !me?.adminView && (role === "owner" || role === "admin" || role === "analyst");
}

// Changes one threat's status and offers Undo. onChange runs right away (optimistic) and again
// with the old status if the request fails or the change is undone.
export function useSetStatus(): (id: string, label: string, from: string, to: string, onChange: (status: string) => void) => Promise<void> {
  const toast = useToast();
  return useCallback(
    async (id, label, from, to, onChange) => {
      onChange(to);
      try {
        await apiFetch(`/api/findings/${id}`, { method: "PATCH", headers: json, body: JSON.stringify({ status: to }) });
        toast({
          message: `${to === "false_positive" ? "Dismissed" : statusLabel(to)}: ${label}`,
          action: {
            label: "Undo",
            onClick: () => {
              onChange(from);
              apiFetch(`/api/findings/${id}`, { method: "PATCH", headers: json, body: JSON.stringify({ status: from }) }).catch(() => {
                onChange(to);
                toast({ message: "Couldn't undo. Reload and try again.", tone: "error" });
              });
            },
          },
        });
      } catch (err) {
        onChange(from);
        toast({ message: err instanceof Error ? err.message : "Couldn't update the threat.", tone: "error" });
      }
    },
    [toast]
  );
}

type ActionsProps = {
  id: string;
  type: string;
  status: string;
  compact?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  takedownHref: string;
  showKeys?: boolean;
};

// The decision buttons for a threat in its current state: confirm, start a takedown, dismiss.
export function ThreatActionButtons({ type, status, compact, onConfirm, onDismiss, takedownHref, showKeys }: ActionsProps) {
  const size = compact ? "sm" : "md";
  const open = status === "new" || status === "investigating";
  const canTakedown = type !== "social" && status !== "false_positive" && status !== "resolved";
  return (
    <>
      {open && (
        <Button variant="primary" size={size} onClick={onConfirm}>
          <Check />
          Confirm threat
          {showKeys && <Kbd className="border-current bg-transparent text-current opacity-60">c</Kbd>}
        </Button>
      )}
      {canTakedown && (
        <Button variant={status === "confirmed" ? "primary" : "secondary"} size={size} asChild>
          <Link href={takedownHref}>
            <Send />
            {status === "confirmed" ? "Take it down" : "Start takedown"}
          </Link>
        </Button>
      )}
      {(open || status === "confirmed") && (
        <Button variant="ghost" size={size} onClick={onDismiss}>
          <X />
          Dismiss
          {showKeys && <Kbd>d</Kbd>}
        </Button>
      )}
    </>
  );
}
