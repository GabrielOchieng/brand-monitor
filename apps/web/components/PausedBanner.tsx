"use client";

import { usePathname } from "next/navigation";
import { PauseCircle } from "lucide-react";
import { useSession } from "../lib/session";

// Shown on every page while a platform admin has paused monitoring for the active organization.
export function PausedBanner() {
  const pathname = usePathname();
  const { me, orgId } = useSession();
  const org = me?.adminView ? { name: me.adminView.name, monitoringPaused: me.adminView.monitoringPaused } : me?.organizations.find((o) => o.id === orgId);
  if (!org?.monitoringPaused || pathname?.startsWith("/admin") || pathname?.startsWith("/report/")) return null;
  return (
    <div className="flex items-start gap-2.5 border-b border-sev-medium/40 bg-sev-medium/10 px-4 py-2 text-[13px] text-muted-foreground lg:px-6">
      <PauseCircle className="mt-0.5 size-4 shrink-0 text-sev-medium" aria-hidden="true" />
      <p>
        <span className="font-semibold text-foreground">Monitoring for {org.name} is paused by the platform admin.</span> Your threats and settings are still here, but
        nothing new is found or scanned.
      </p>
    </div>
  );
}
