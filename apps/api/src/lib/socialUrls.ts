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
  instagram: new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "direct", "about", "legal", "developer"]),
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

// `title` is the search result's title, used only where the URL itself has no handle
// (an Instagram post at /p/<id> is titled "Name (@handle) • Instagram ...").
export function parseSocialUrl(raw: string, title?: string | null): SocialAccount | null {
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
      const fromTitle = title?.match(/\(@([a-z0-9._]+)\)/i)?.[1];
      return fromTitle ? account(platform, fromTitle) : null;
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

// Handles are compared with separators stripped: "fly.jambojet", "fly_jambojet" and
// "flyjambojet" are the same name to a victim.
export function normalizeHandle(handle: string): string {
  return handle.toLowerCase().replace(/[._-]+/g, "");
}
