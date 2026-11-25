"use client";

import { AutomationLoading, SenderCard, useAutomation } from "../../../../components/settings/AutoTakedownSettings";
import { SettingsHead } from "../../../../components/settings/Section";
import { useMyRole } from "../../../../lib/useMyRole";

export default function SenderPage() {
  const role = useMyRole();
  const { data, reload } = useAutomation();
  if (!data) return <AutomationLoading />;
  return (
    <section className="flex flex-col gap-4">
      <SettingsHead title="Sender mailbox" description="Reports go out from your own mailbox, so replies come back to you and pass your domain's email checks." />
      <SenderCard data={data} isOwner={role === "owner"} canTest={role === "owner" || role === "admin"} onChange={reload} />
    </section>
  );
}
