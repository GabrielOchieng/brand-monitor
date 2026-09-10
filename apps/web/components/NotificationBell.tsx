"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "../lib/api";

export function NotificationBell() {
  const { getToken, isLoaded, orgId } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const poll = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await apiFetch<{ unreadCount: number }>("/api/notifications", token);
      setUnreadCount(data.unreadCount);
    } catch {
      // notifications are non-critical -- a transient failure just skips this tick
    }
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !orgId) return;
    poll();
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, [isLoaded, orgId, poll]);

  if (!isLoaded || !orgId) return null;

  return (
    <Link href="/notifications" className="relative text-gray-400 hover:text-gray-100" aria-label="Notifications">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6v-5a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
