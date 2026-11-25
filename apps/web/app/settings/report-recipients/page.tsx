"use client";

import { ReportRecipientSettings } from "../../../components/settings/ReportRecipientSettings";
import { useMyRole } from "../../../lib/useMyRole";

export default function ReportRecipientsPage() {
  return <ReportRecipientSettings role={useMyRole()} />;
}
