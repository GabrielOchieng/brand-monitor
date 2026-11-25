"use client";

import { AutomationLoading, useAutomation } from "../../../../components/settings/AutoTakedownSettings";
import { CloudflareCard } from "../../../../components/settings/CloudflareCard";
import { SettingsHead } from "../../../../components/settings/Section";
import { useMyRole } from "../../../../lib/useMyRole";

export default function CloudflarePage() {
  const role = useMyRole();
  const { data, reload } = useAutomation();
  if (!data) return <AutomationLoading />;
  return (
    <section className="flex flex-col gap-4">
      <SettingsHead title="Cloudflare" description="Optional. Reports about sites behind Cloudflare go through its abuse-reports API instead of its web form." />
      <CloudflareCard integration={data.integrations.find((i) => i.provider === "cloudflare") ?? null} isOwner={role === "owner"} canTest={role === "owner" || role === "admin"} onChange={reload} />
    </section>
  );
}
