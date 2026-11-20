// App store listings as stable identities: the brand's official apps (kept in the official
// accounts list, Brand.officialSocialUrls) and the findings the app monitors create
// (pipeline/appStoreMonitorJob.ts) are compared by store + app id, never by name.

export interface AppListing {
  store: "google_play" | "app_store";
  appId: string;
  url: string;
}

// https://play.google.com/store/apps/details?id=com.jambojet.booking.twa&hl=en
// https://apps.apple.com/ke/app/flyjambojet/id1234567890?uo=4
export function parseAppListingUrl(raw: string): AppListing | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "play.google.com" && url.pathname.replace(/\/+$/, "") === "/store/apps/details") {
    const id = url.searchParams.get("id");
    if (!id || !/^[A-Za-z][\w]*(\.[A-Za-z0-9_]+)+$/.test(id)) return null;
    return { store: "google_play", appId: id, url: googlePlayUrl(id) };
  }
  if (host === "apps.apple.com" || host === "itunes.apple.com") {
    const id = url.pathname.match(/\/id(\d+)\/?$/)?.[1];
    if (!id) return null;
    return { store: "app_store", appId: id, url: `https://apps.apple.com/app/id${id}` };
  }
  return null;
}

export function googlePlayUrl(appId: string): string {
  return `https://play.google.com/store/apps/details?id=${appId}`;
}

export function isOfficialApp(officialUrls: string[], store: AppListing["store"], appId: string): boolean {
  return officialUrls.some((u) => {
    const app = parseAppListingUrl(u);
    return app?.store === store && app.appId === appId;
  });
}

export function isOfficialListing(officialUrls: string[], listingUrl: string): boolean {
  const app = parseAppListingUrl(listingUrl);
  return Boolean(app && isOfficialApp(officialUrls, app.store, app.appId));
}
