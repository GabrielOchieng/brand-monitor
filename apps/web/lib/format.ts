// Display helpers shared by every page: the API speaks in codes and full URLs, people
// read names.

const SOURCE_LABELS: Record<string, string> = {
  pipeline: "Discovery",
  manual_submission: "Added manually",
  social_search: "Social search",
  web_search: "Web search",
  ct_log: "Certificate logs",
  nrd: "New-domain feed",
  nrd_hagezi: "New-domain feed (hagezi)",
  app_store: "App Store",
  google_play: "Google Play",
  phish_feed: "Phishing feed",
  public_report: "Public report",
  seed_demo: "Demo data",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  investigating: "Investigating",
  confirmed: "Confirmed",
  false_positive: "False positive",
  resolved: "Resolved",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export const STATUS_PILL: Record<string, string> = {
  new: "border-brand/30 bg-brand/10 text-brand",
  investigating: "border-sky-200 bg-sky-50 text-sky-700",
  confirmed: "border-amber-200 bg-amber-50 text-amber-800",
  false_positive: "border-line bg-elevated text-ink-subtle",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

// "just now", "12m ago", "5h ago", "3d ago", then a short date.
export function timeAgo(iso: string | Date, now: Date = new Date()): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function fullDate(iso: string | Date): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const PLATFORMS: Array<{ match: RegExp; name: string; at: boolean }> = [
  { match: /(^|\.)instagram\.com$/, name: "Instagram", at: true },
  { match: /(^|\.)tiktok\.com$/, name: "TikTok", at: false },
  { match: /(^|\.)facebook\.com$|(^|\.)fb\.com$/, name: "Facebook", at: false },
  { match: /(^|\.)(x|twitter)\.com$/, name: "X", at: true },
  { match: /^t\.me$|(^|\.)telegram\.me$/, name: "Telegram", at: true },
  { match: /(^|\.)youtube\.com$/, name: "YouTube", at: false },
  { match: /^play\.google\.com$/, name: "Google Play", at: false },
  { match: /^apps\.apple\.com$|^itunes\.apple\.com$/, name: "App Store", at: false },
];

export interface TargetDisplay {
  // What the finding is called: a domain, an @handle, an app id, or a host.
  primary: string;
  // Where it lives: "Instagram account", a URL path, "Google Play app".
  secondary: string | null;
  platform: string | null;
}

export function describeTarget(identifier: string, type: string): TargetDisplay {
  if (type === "domain") return { primary: identifier, secondary: null, platform: null };
  let url: URL;
  try {
    url = new URL(identifier);
  } catch {
    return { primary: identifier, secondary: null, platform: null };
  }
  const host = url.hostname.replace(/^(www|m|web)\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const platform = PLATFORMS.find((p) => p.match.test(host));

  if (platform?.name === "Google Play") {
    return { primary: url.searchParams.get("id") ?? identifier, secondary: "Google Play app", platform: platform.name };
  }
  if (platform?.name === "App Store") {
    const slug = segments.find((s, i) => segments[i - 1] === "app" && !/^id\d+$/.test(s));
    return { primary: slug ? slug.replace(/-/g, " ") : identifier, secondary: "App Store app", platform: platform.name };
  }
  if (platform) {
    // A profile: one path segment ("jambotjet01235", "@fly.jambojet"). Anything longer is a
    // single post kept as its own finding because its poster wasn't identifiable.
    if (segments.length === 1) {
      const handle = segments[0].replace(/^@/, "");
      const shown = platform.at || segments[0].startsWith("@") ? `@${handle}` : handle;
      return { primary: shown, secondary: `${platform.name} account`, platform: platform.name };
    }
    return { primary: `${platform.name} post`, secondary: `${host}${url.pathname}`, platform: platform.name };
  }
  const path = `${url.pathname === "/" ? "" : url.pathname}${url.search}`;
  return { primary: host, secondary: path || null, platform: null };
}

// Search-engine snippets of social posts arrive as scraped markdown: "# <title> [Image: …]
// - Author: @x (Name) - Posted: 2026-… - Type: clips - Likes: 0 - Comments: 0". Keep the
// words people wrote; drop headings, image descriptions and the metadata fields.
const META_FIELDS = /(?:^|\s+)-\s*(Author|Posted|Type|Audio|Likes|Comments|Comment count|Reactions|Shares|Views|Hashtags|Location):.*?(?=\s+-\s+[A-Z][\w ]{1,20}:|$)/g;

export function cleanSnippet(snippet: string | null, title?: string | null): string {
  if (!snippet) return "";
  let s = snippet
    .replace(/\[Image:[^\]]*\]/gi, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*Title:[^\n]*\n?/i, "")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(META_FIELDS, "")
    .replace(/\s*\[\.\.\.\]\s*/g, " … ")
    .replace(/\s+/g, " ")
    .trim();
  // The snippet often repeats the title first.
  const t = title?.trim();
  if (t && s.toLowerCase().startsWith(t.toLowerCase())) s = s.slice(t.length).replace(/^[\s:.\-–|]+/, "");
  return s.replace(/^-\s*/, "").trim();
}
