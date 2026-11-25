"use client";

import { AutomationSetup } from "../../../components/settings/AutoTakedownSettings";
import { useMyRole } from "../../../lib/useMyRole";

export default function AutomaticReportingPage() {
  return <AutomationSetup role={useMyRole()} />;
}
