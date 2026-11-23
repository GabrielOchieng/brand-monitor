"use client";

import { usePathname } from "next/navigation";
import { useSession } from "../lib/session";

// Shown on every page while a platform admin has paused monitoring for the active organization.
export function PausedBanner() {
  const pathname = usePathname();
  const { me, orgId } = useSession();
  const org = me?.adminView ? { name: me.adminView.name, monitoringPaused: me.adminView.monitoringPaused } : me?.organizations.find((o) => o.id === orgId);
  if (!org?.monitoringPaused || pathname?.startsWith("/admin") || pathname?.startsWith("/report/")) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <p className="mx-auto max-w-7xl px-4 py-2 text-sm text-amber-900 sm:px-6">
        Monitoring for {org.name} is paused by the platform admin. Your findings and settings are still here, but nothing new is discovered or scanned.
      </p>
    </div>
  );
}
