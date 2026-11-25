"use client";

import type { ReactNode } from "react";
import { AutomationProvider } from "../../../components/settings/AutoTakedownSettings";

// One overview request shared by every automatic-reporting page.
export default function AutomaticReportingLayout({ children }: { children: ReactNode }) {
  return <AutomationProvider>{children}</AutomationProvider>;
}
