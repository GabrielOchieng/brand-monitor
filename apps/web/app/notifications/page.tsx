"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../../lib/api";

interface Notification {
  id: string;
  findingId: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const { getToken } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = await getToken();
    const data = await apiFetch<{ notifications: Notification[] }>("/api/notifications", token);
    setNotifications(data.notifications);
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string) {
    const token = await getToken();
    await apiFetch(`/api/notifications/${id}/read`, token, { method: "POST" });
    load();
  }

  async function markAllRead() {
    const token = await getToken();
    await apiFetch("/api/notifications/read-all", token, { method: "POST" });
    load();
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Notifications</h1>
        <button onClick={markAllRead} className="btn-ghost text-xs">
          Mark all read
        </button>
      </div>

      {loading && <p className="mt-4 text-sm text-ink-subtle">Loading…</p>}

      <div className="card mt-6 divide-y divide-line">
        {notifications.map((n) => (
          <div key={n.id} className={`flex items-center justify-between px-4 py-3 ${n.readAt ? "opacity-50" : ""}`}>
            <div>
              <Link href={`/threats/${n.findingId}`} className="text-sm text-ink hover:text-brand-hover">
                {n.message}
              </Link>
              <div className="text-xs text-ink-subtle">{new Date(n.createdAt).toLocaleString()}</div>
            </div>
            {!n.readAt && (
              <button onClick={() => markRead(n.id)} className="btn-ghost shrink-0 text-xs">
                Mark read
              </button>
            )}
          </div>
        ))}
        {!loading && notifications.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-ink-subtle">No notifications yet.</div>
        )}
      </div>
    </div>
  );
}
