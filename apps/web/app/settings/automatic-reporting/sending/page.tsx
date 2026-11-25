"use client";

import { AutomationLoading, useAutomation } from "../../../../components/settings/AutoTakedownSettings";
import { AutoTakedownSending } from "../../../../components/settings/AutoTakedownSending";
import { SettingsHead } from "../../../../components/settings/Section";
import { Banner } from "../../../../components/ui/Banner";
import { useMyRole } from "../../../../lib/useMyRole";

export default function SendingRulesPage() {
  const role = useMyRole();
  const { data, error, setError, reload } = useAutomation();
  if (!data) return <AutomationLoading />;
  return (
    <section className="flex flex-col gap-4">
      <SettingsHead title="Sending rules" description="Test mode or live, which threats qualify, how fast reports go out, and what happens when nobody answers." />
      {error && <Banner tone="error">{error}</Banner>}
      <AutoTakedownSending data={data} role={role} onChange={reload} onError={setError} />
    </section>
  );
}
