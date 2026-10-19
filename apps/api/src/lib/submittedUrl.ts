// A URL a person handed us (analyst manual submission, or a public scam report), turned
// into a finding identity.

import { parseSocialUrl } from "./socialUrls";

// Loopback/private/link-local/metadata hostnames rejected here as a fast, string-only
// pre-check for immediate user feedback -- NOT the authoritative SSRF gate, which can't
// be done by string matching alone (a domain can resolve to a private IP only at fetch
// time). The real gate is in the scanner service itself, right before navigation
// (apps/scanner/src/ssrfGuard.ts), which resolves the hostname first.
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^169\.254\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
];

export type SubmittedTarget =
  | { ok: true; hostname: string; identifier: string; type: "domain" | "url" | "social"; postUrl?: string }
  | { ok: false; error: "invalid_url" | "target_not_allowed" };

export function parseSubmittedUrl(raw: string): SubmittedTarget {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return { ok: false, error: "invalid_url" };
  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(target.hostname))) return { ok: false, error: "target_not_allowed" };

  // Bare domain (no path/query/hash) is structurally identical to what discovery
  // produces -- rides recheckJob.ts's unmodified domain-enrichment path. Anything
  // else (a specific page) is scored as its own URL -- see
  // the type-branch in recheckJob.ts.
  const isBareDomain = (target.pathname === "" || target.pathname === "/") && !target.search && !target.hash;
  const hostname = target.hostname.toLowerCase();

  // A post or profile on a social platform is tracked as the account behind it -- the
  // scanner can't read those pages anyway (lib/socialUrls.ts, recheckJob.ts).
  const social = parseSocialUrl(target.toString());
  if (social) {
    const postUrl = target.toString();
    return { ok: true, hostname, type: "social", identifier: social.profileUrl, ...(postUrl !== social.profileUrl ? { postUrl } : {}) };
  }

  return { ok: true, hostname, type: isBareDomain ? "domain" : "url", identifier: isBareDomain ? hostname : target.toString() };
}
