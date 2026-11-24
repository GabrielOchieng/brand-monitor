"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";
import { useSession } from "../../lib/session";
import { LoadingRegion, SkeletonList } from "../../components/Skeleton";
import { PageHeader } from "../../components/ui/PageHeader";

interface Notification {
  id: string;
  findingId: string | null;
  reportId: string | null;
  link: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A platform admin's read-only view can't mark anything read.
  const readOnly = !!useSession().me?.adminView;

  const load = useCallback(async () => {
    const data = await apiFetch<{ notifications: Notification[] }>("/api/notifications");
    setNotifications(data.notifications);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }
  const markRead = (id: string) => act(() => apiFetch(`/api/notifications/${id}/read`, { method: "POST" }));
  const markAllRead = () => act(() => apiFetch("/api/notifications/read-all", { method: "POST" }));

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Alerts from your alert rules: new and rising threats, sites going live or coming back, registration changes, public reports and takedown activity."
        actions={
          !readOnly && (
            <button onClick={markAllRead} className="btn-secondary">
              Mark all read
            </button>
          )
        }
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {loading && (
        <LoadingRegion label="Loading notifications" className="mt-6">
          <SkeletonList rows={6} lines={1} />
        </LoadingRegion>
      )}

      <div className={`card mt-6 divide-y divide-line ${loading ? "hidden" : ""}`}>
        {notifications.map((n) => (
          <div key={n.id} className={`flex items-center justify-between px-4 py-3 ${n.readAt ? "opacity-50" : ""}`}>
            <div>
              {/* A fact-check links out to the article; a public report that matched no finding
                  links to the reports list; anything else (a finished manual social search) to
                  the threat feed. */}
              {n.link ? (
                <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-sm text-ink hover:text-brand-hover">
                  {n.message}
                </a>
              ) : (
                <Link
                  href={n.findingId ? `/threats/${n.findingId}` : n.reportId ? "/reports" : "/threats"}
                  className="text-sm text-ink hover:text-brand-hover"
                >
                  {n.message}
                </Link>
              )}
              <div className="text-xs text-ink-subtle">{new Date(n.createdAt).toLocaleString()}</div>
            </div>
            {!n.readAt && !readOnly && (
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
