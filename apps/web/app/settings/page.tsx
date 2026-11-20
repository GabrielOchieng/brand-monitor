"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { BrandSettings } from "../../components/settings/BrandSettings";
import { AlertSettings } from "../../components/settings/AlertSettings";
import { IntegrationSettings } from "../../components/settings/IntegrationSettings";
import { Section } from "../../components/settings/Section";
import { TeamMembers } from "../../components/TeamMembers";
import { SettingsSkeleton } from "../../components/PageSkeletons";
import { canManage, useMyRole } from "../../lib/useMyRole";

const TABS = [
  { id: "brand", label: "Brand" },
  { id: "alerts", label: "Alerts" },
  { id: "integrations", label: "Integrations" },
  { id: "team", label: "Team" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Settings in four tabs, the tab kept in the URL (?tab=alerts) so it survives a reload
// and can be linked to.
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const params = useSearchParams();
  const { isLoaded, orgId } = useAuth();
  const role = useMyRole();
  const requested = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : "brand";

  if (!isLoaded || (orgId && role === null)) return <SettingsSkeleton />;
  const editable = canManage(role);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
      <p className="mt-1 text-sm text-ink-subtle">How this organization is monitored and alerted.</p>

      <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Settings sections">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/settings?tab=${t.id}`}
            scroll={false}
            aria-current={tab === t.id ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id ? "border-brand text-ink" : "border-transparent text-ink-subtle hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-8">
        {tab === "brand" && <BrandSettings editable={editable} />}
        {tab === "alerts" && <AlertSettings editable={editable} />}
        {tab === "integrations" && <IntegrationSettings editable={editable} />}
        {tab === "team" && (
          <Section
            title="Team"
            description={
              <>
                Who can see and act on findings. Owners manage everything, including roles; admins manage settings; analysts triage findings; viewers can only look. Invite
                people from the organization menu at the top right (Manage, then Members); they join as viewers.
              </>
            }
          >
            <TeamMembers />
          </Section>
        )}
      </div>
    </div>
  );
}
