// Where an old Settings link (one page switching sections with ?section= or, before that, ?tab=)
// goes now that every section has its own page. Bookmarks and links in old emails keep working.

const BRAND_TABS: Record<string, string> = {
  details: "details",
  keywords: "keywords",
  accounts: "accounts",
  "report-form": "report-form",
  visual: "visual",
  delete: "details",
  "add-brand": "details",
};

const PAGES: Record<string, string> = {
  alerts: "/settings/alerts",
  webhook: "/settings/webhook",
  "auto-takedown": "/settings/automatic-reporting",
  "report-templates": "/settings/report-templates",
  "report-recipients": "/settings/report-recipients",
  team: "/team",
};

const LEGACY_TABS: Record<string, string> = { brand: "details", alerts: "alerts", integrations: "webhook", team: "team" };

export function settingsRedirect(section: string | null, tab: string | null): string {
  const s = section ?? (tab ? LEGACY_TABS[tab] : undefined) ?? null;
  if (s && BRAND_TABS[s]) {
    const t = BRAND_TABS[s];
    const add = s === "add-brand" ? "&add=1" : "";
    return t === "details" ? `/brands${add ? "?add=1" : ""}` : `/brands?tab=${t}${add}`;
  }
  if (s && PAGES[s]) return PAGES[s];
  return "/settings/alerts";
}
