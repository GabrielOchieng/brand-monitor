"use client";

import { AuthorizationCard, AutomationLoading, useAutomation } from "../../../../components/settings/AutoTakedownSettings";
import { SettingsHead } from "../../../../components/settings/Section";
import { useMyRole } from "../../../../lib/useMyRole";

export default function AuthorizationPage() {
  const role = useMyRole();
  const { data, reload } = useAutomation();
  if (!data) return <AutomationLoading />;
  return (
    <section className="flex flex-col gap-4">
      <SettingsHead title="Authorization" description="Who authorizes takedown reports on your organization's behalf, for which brands and until when, with the signed letter attached to reports." />
      <AuthorizationCard data={data} isOwner={role === "owner"} onChange={reload} />
    </section>
  );
}
