"use client";

import { IntegrationSettings } from "../../../components/settings/IntegrationSettings";
import { canManage, useMyRole } from "../../../lib/useMyRole";
import { useSession } from "../../../lib/session";

export default function WebhookSettingsPage() {
  const role = useMyRole();
  const { me } = useSession();
  return <IntegrationSettings editable={canManage(role) && !me?.adminView} />;
}
