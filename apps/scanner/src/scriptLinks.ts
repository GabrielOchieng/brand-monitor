// Contact links that exist only inside a page's JavaScript. Scam booking flows build their
// WhatsApp link when the victim clicks "Book Now" and open it with window.open, so it is
// never an <a href> on the page (jambo-jet.com, 2026-11-20:
// qt=`https://wa.me/254710492539?text=${...}`; window.open(qt)). Only link shapes are
// taken -- never bare digit runs, which JS bundles are full of. apps/api/src/lib/indicators.ts
// does the actual parsing and normalising.

const MAX_LINKS = 100;

const SCRIPT_LINK_PATTERN =
  /(?:wa\.me\/\+?\d{8,15}|(?:api\.whatsapp\.com\/send|whatsapp:\/\/send)\/?\?[^\s"'`<>\\]*phone=\+?\d{8,15}|(?:t|telegram)\.me\/\+?[A-Za-z0-9_]{4,64}|tel:\+?\d[\d\s().-]{5,18}\d)/gi;

export function extractScriptLinks(scripts: string[]): string[] {
  const found = new Set<string>();
  for (const script of scripts) {
    for (const m of script.matchAll(SCRIPT_LINK_PATTERN)) {
      found.add(m[0]);
      if (found.size >= MAX_LINKS) return [...found];
    }
  }
  return [...found];
}

// The site's own scripts only -- third-party bundles (analytics, chat widgets, CDNs) carry
// example and vendor numbers that say nothing about who runs this page.
export function isFirstPartyScript(scriptUrl: string, pageHosts: string[]): boolean {
  let host: string;
  try {
    host = new URL(scriptUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return pageHosts.some((h) => {
    const base = h.toLowerCase().replace(/^www\./, "");
    return host === base || host.endsWith(`.${base}`);
  });
}
