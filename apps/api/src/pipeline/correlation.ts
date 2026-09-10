// Registrar strings come back as raw, unnormalized text from RDAP/WHOIS (see lib/rdap.ts,
// lib/whois.ts) -- "NameCheap, Inc." vs "NAMECHEAP INC" vs "Namecheap.com, LLC" would
// silently fail an exact-string correlation match despite being the same registrar. Exact
// canonical correctness doesn't matter here, only that the SAME registrar normalizes to the
// SAME string on both sides of a comparison.
export function normalizeRegistrar(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const CORRELATION_WINDOW_DAYS = 7;
