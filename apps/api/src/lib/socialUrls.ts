// Turns a link to anything on a social platform (a post, a video, a profile) into the
// account behind it. A social finding is the ACCOUNT, not the post: one fake page posts
// many times, and it's the page that gets reported and taken down.
//
// Identity is a canonical profile URL ("https://www.tiktok.com/@fly.jambojet"), with the
// handle lowercased -- every platform here treats handles case-insensitively, and
// "FlyJambojetUG" vs "flyjambojetug" must not become two findings.

export type SocialPlatform = "facebook" | "instagram" | "tiktok" | "x" | "telegram" | "youtube";

export interface SocialAccount {
  platform: SocialPlatform;
  // Null for an account that only has a numeric id (facebook.com/profile.php?id=...).
  handle: string | null;
  profileUrl: string;
}

export const SOCIAL_SEARCH_DOMAINS: Record<SocialPlatform, string[]> = {
  facebook: ["facebook.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  x: ["x.com", "twitter.com"],
  telegram: ["t.me"],
  youtube: ["youtube.com"],
};

const HOST_PLATFORM: Record<string, SocialPlatform> = {
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "x.com": "x",
  "twitter.com": "x",
  "t.me": "telegram",
  "telegram.me": "telegram",
  "youtube.com": "youtube",
};

// First path segments that are platform pages, not accounts.
const RESERVED: Record<SocialPlatform, Set<string>> = {
  facebook: new Set([
    "watch", "share", "sharer", "sharer.php", "story.php", "photo", "photo.php", "photos", "events", "reel", "reels",
    "login", "login.php", "help", "policies", "privacy", "marketplace", "hashtag", "search", "groups", "gaming",
    "permalink.php", "media", "business", "ads", "home.php", "l.php", "dialog", "plugins", "settings", "notes",
  ]),
  instagram: new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "direct", "about", "legal", "developer", "popular", "web"]),
  tiktok: new Set(["discover", "tag", "music", "search", "foryou", "following", "explore", "live", "embed", "trending"]),
  x: new Set(["i", "search", "hashtag", "home", "explore", "intent", "share", "settings", "messages", "notifications", "login", "tos", "privacy"]),
  telegram: new Set(["joinchat", "share", "addstickers", "addemoji", "proxy", "socks", "iv", "contact"]),
  youtube: new Set(["watch", "results", "shorts", "playlist", "feed", "embed", "live", "redirect", "hashtag", "about", "t", "premium", "gaming"]),
};

const PROFILE_BASE: Record<SocialPlatform, string> = {
  facebook: "https://www.facebook.com/",
  instagram: "https://www.instagram.com/",
  tiktok: "https://www.tiktok.com/@",
  x: "https://x.com/",
  telegram: "https://t.me/",
  youtube: "https://www.youtube.com/@",
};

const HANDLE_RE = /^[a-z0-9._-]+$/i;

function account(platform: SocialPlatform, handle: string): SocialAccount | null {
  if (!HANDLE_RE.test(handle)) return null;
  const h = handle.toLowerCase();
  return { platform, handle: h, profileUrl: `${PROFILE_BASE[platform]}${h}` };
}

export function socialPlatformForHost(hostname: string): SocialPlatform | null {
  const host = hostname.toLowerCase().replace(/^(www|m|mobile|web|vm|vt)\./, "");
  return HOST_PLATFORM[host] ?? null;
}

// The poster's handle as a search result's text states it, for URLs that don't carry one
// (an Instagram post at /p/<id>): "Name (@handle) • Instagram ..." in the title, or
// "Author: @handle (Name)" in the snippet -- seen 2026-11-20 on a reel titled only
// "Jambo Jet Airline on Instagram", which was the fake @jambotjet01235.
function handleFromResultText(title?: string | null, snippet?: string | null): string | null {
  return title?.match(/\(@([a-z0-9._]+)\)/i)?.[1] ?? snippet?.match(/\bAuthor:\s*@([a-z0-9._]+)/i)?.[1] ?? null;
}

// `title` and `snippet` are the search result's, used only where the URL itself has no
// handle.
export function parseSocialUrl(raw: string, title?: string | null, snippet?: string | null): SocialAccount | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const platform = socialPlatformForHost(url.hostname);
  if (!platform) return null;

  const segments = url.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  const first = segments[0] ?? "";

  switch (platform) {
    case "facebook": {
      if (first === "profile.php") {
        const id = url.searchParams.get("id");
        return id && /^\d+$/.test(id) ? { platform, handle: null, profileUrl: `https://www.facebook.com/profile.php?id=${id}` } : null;
      }
      // facebook.com/people/Name/<id> and facebook.com/pages/Name/<id>: the id is the identity.
      if ((first === "people" || first === "pages") && segments[2] && /^\d+$/.test(segments[2])) {
        return { platform, handle: null, profileUrl: `https://www.facebook.com/profile.php?id=${segments[2]}` };
      }
      if (!first || RESERVED.facebook.has(first.toLowerCase())) return null;
      return account(platform, first);
    }
    case "instagram": {
      if (first && !RESERVED.instagram.has(first.toLowerCase())) return account(platform, first);
      const fromText = handleFromResultText(title, snippet);
      return fromText ? account(platform, fromText) : null;
    }
    case "tiktok": {
      if (!first.startsWith("@")) return null;
      return account(platform, first.slice(1));
    }
    case "x": {
      if (!first || RESERVED.x.has(first.toLowerCase())) return null;
      return account(platform, first);
    }
    case "telegram": {
      // t.me/s/<channel> is the public web preview of the same channel.
      const name = first === "s" ? segments[1] : first;
      // t.me/+<hash> is a private invite link -- no public identity to track.
      if (!name || name.startsWith("+") || RESERVED.telegram.has(name.toLowerCase())) return null;
      return account(platform, name);
    }
    case "youtube": {
      if (first.startsWith("@")) return account(platform, first.slice(1));
      if ((first === "channel" || first === "c" || first === "user") && segments[1]) {
        const id = segments[1];
        return HANDLE_RE.test(id) ? { platform, handle: id.toLowerCase(), profileUrl: `https://www.youtube.com/${first}/${id}` } : null;
      }
      return null;
    }
  }
}

// First path segments of pages that collect many people's posts (TikTok /discover,
// Instagram /explore): a number on one isn't any single poster's.
const AGGREGATE_PAGES = new Set(["discover", "tag", "explore", "search", "hashtag", "popular", "topics", "music", "trending"]);

// A single post whose account we can't tell (an Instagram /p/ link with no handle in the
// result text, a Facebook group post), as a stand-in "account" keyed on the post's own URL,
// so a scam post can still become a finding. Null for aggregate pages.
export function postAsAccount(raw: string): SocialAccount | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const platform = socialPlatformForHost(url.hostname);
  if (!platform) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2 || AGGREGATE_PAGES.has(segments[0].toLowerCase())) return null;
  // Facebook keeps the post id in the query for some links (permalink.php?story_fbid=...).
  const keepQuery = platform === "facebook" && /\.php$/.test(segments[segments.length - 1]);
  const profileUrl = `${url.protocol}//${url.hostname.toLowerCase().replace(/^(m|mobile|web)\./, "www.")}${url.pathname.replace(/\/+$/, "")}${keepQuery ? url.search : ""}`;
  return { platform, handle: null, profileUrl };
}

// Handles are compared with separators stripped: "fly.jambojet", "fly_jambojet" and
// "flyjambojet" are the same name to a victim.
export function normalizeHandle(handle: string): string {
  return handle.toLowerCase().replace(/[._-]+/g, "");
}
