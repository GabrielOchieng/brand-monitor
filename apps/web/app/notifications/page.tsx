"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useSession } from "../../lib/session";
import { fullDate, timeAgo } from "../../lib/format";
import { notificationHref } from "../../lib/notificationHref";
import { cn } from "../../lib/cn";
import { LoadingRegion, SkeletonList } from "../../components/Skeleton";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { EmptyState } from "../../components/ui/EmptyState";

interface Notification {
  id: string;
  findingId: string | null;
  reportId: string | null;
  link: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
}

// Everything the alert rules sent to the app, newest first. The bell in the top bar shows the
// latest few; this is the full list.
export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A platform admin's read-only view can't mark anything read.
  const readOnly = !!useSession().me?.adminView;

  const load = useCallback(async () => {
    const data = await apiFetch<{ notifications: Notification[] }>("/api/notifications");
    setNotifications(data.notifications);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const unread = notifications?.filter((n) => !n.readAt).length ?? 0;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Notifications"
        description="Alerts from your alert rules: new and rising threats, sites going live or coming back, registration changes, public reports and takedown activity."
        actions={
          !readOnly &&
          unread > 0 && (
            <Button onClick={() => act(() => apiFetch("/api/notifications/read-all", { method: "POST" }))}>
              <CheckCheck />
              Mark all read
            </Button>
          )
        }
      />
      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      {!notifications ? (
        <LoadingRegion label="Loading notifications">
          <SkeletonList rows={6} lines={1} />
        </LoadingRegion>
      ) : notifications.length === 0 ? (
        <EmptyState title="No notifications yet">Alerts appear here when your alert rules fire. Choose which ones under Settings → Alerts.</EmptyState>
      ) : (
        <ul className="rounded-md border border-border bg-card">
          {notifications.map((n) => {
            const { href, external } = notificationHref(n);
            const cls = cn("hover:text-primary", n.readAt ? "text-muted-foreground" : "text-foreground");
            return (
              <li key={n.id} className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-start gap-3 border-b border-border px-3.5 py-2.5 text-[13px] last:border-b-0">
                <span className={cn("mt-1.5 size-2 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-label={n.readAt ? undefined : "Unread"} />
                <div className="min-w-0">
                  {external ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
                      {n.message}
                    </a>
                  ) : (
                    <Link href={href} className={cls}>
                      {n.message}
                    </Link>
                  )}
                  <time className="block font-mono text-[11.5px] text-subtle" title={fullDate(n.createdAt)}>
                    {timeAgo(n.createdAt)}
                  </time>
                </div>
                {!n.readAt && !readOnly && (
                  <Button size="sm" variant="ghost" onClick={() => act(() => apiFetch(`/api/notifications/${n.id}/read`, { method: "POST" }))}>
                    Mark read
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
