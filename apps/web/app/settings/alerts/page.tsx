"use client";

import { AlertSettings } from "../../../components/settings/AlertSettings";
import { canManage, useMyRole } from "../../../lib/useMyRole";
import { useSession } from "../../../lib/session";

export default function AlertsSettingsPage() {
  const role = useMyRole();
  const { me } = useSession();
  return <AlertSettings editable={canManage(role) && !me?.adminView} />;
}
