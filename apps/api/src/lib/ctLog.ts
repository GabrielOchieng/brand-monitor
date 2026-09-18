// crt.sh: a free, public Certificate Transparency search API (no API key, no documented
// rate limit) over the same log data CertStream's real-time firehose reads from. Pull-
// based, unlike CertStream's persistent WebSocket connection -- a much better fit for this
// app's architecture (short-lived scheduled pg-boss jobs only, no persistent connections
// anywhere) and Render's tight 512MB budget. Every publicly-trusted TLS cert issuance is
// permanently logged here, so this catches real squats regardless of what naming pattern
// they follow -- complementary to permutations.ts's guess-then-DNS-check approach, not a
// replacement for it (won't catch a homoglyph/IDN squat that doesn't literally contain the
// brand name as an ASCII substring -- that's permutations.ts's job).
// crt.sh's name_value field isn't purely SANs -- confirmed real: a live query returned
// "jambojet limited" (an organization-name string) as one of the newline-separated lines
// alongside genuine hostnames, for certs where the CA embedded extra non-DNS text. A basic
// hostname shape check (labels of alnum/hyphen, at least one dot, no spaces) filters these
// out before they'd otherwise become a garbage Finding identifier that can never resolve.
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export async function queryCtLog(brandRoot: string): Promise<string[] | null> {
  try {
    const url = `https://crt.sh/?q=${encodeURIComponent(`%${brandRoot}%`)}&output=json`;
    // Longer timeout than rdap.ts/favicon.ts's 6000ms -- crt.sh is a shared, sometimes-slow
    // Postgres-backed service, not a quick lookup.
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ name_value?: string }>;

    const hostnames = new Set<string>();
    for (const row of rows) {
      if (!row.name_value) continue;
      // One cert can cover multiple SANs, only some of which may actually contain the
      // brand substring (a multi-domain cert can bundle unrelated names) -- callers still
      // re-check the substring themselves; this only normalizes each line.
      for (const line of row.name_value.split("\n")) {
        // Strip a leading "*." wildcard marker and a trailing-dot FQDN form -- the latter
        // would otherwise break the own-domain suffix check downstream
        // (endsWith(".brand.com") false-negatives on "portal.brand.com.").
        const hostname = line.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
        if (hostname && HOSTNAME_PATTERN.test(hostname)) hostnames.add(hostname);
      }
    }
    return [...hostnames];
  } catch {
    // Network error, timeout, non-2xx, or malformed JSON -- treat all the same: skip this
    // round, the next scheduled dispatch tick tries again. Not worth alerting on a
    // transient failure of a free public service we don't control.
    return null;
  }
}
