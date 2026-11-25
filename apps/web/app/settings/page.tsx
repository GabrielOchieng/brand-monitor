import { redirect } from "next/navigation";
import { settingsRedirect } from "../../lib/settingsRoutes";

// /settings itself has no content: it sends old links (?section=..., ?tab=...) to their new
// pages, and everything else to the first section.
export default async function SettingsIndex({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  redirect(settingsRedirect(sp.section ?? null, sp.tab ?? null));
}
