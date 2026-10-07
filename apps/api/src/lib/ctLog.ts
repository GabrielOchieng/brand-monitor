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

// crt.sh is frequently overloaded (Oct 2026: 502s and 60s timeouts for days at a time),
// so one retry per call, and every failure is logged -- this used to return null silently,
// which hid the fact that CT monitoring had never produced a single production finding.
// Callers record success via markSourceSuccess so /health/jobs can report staleness.
async function fetchCtRows(brandRoot: string): Promise<Array<{ name_value?: string }>> {
  // exclude=expired + deduplicate=Y: a smaller result set is both cheaper for crt.sh to
  // compute (fewer timeouts) and less inbound traffic for us; an expired cert's names
  // were either caught while it was live or are no longer interesting.
  const url = `https://crt.sh/?q=${encodeURIComponent(`%${brandRoot}%`)}&output=json&exclude=expired&deduplicate=Y`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // Longer timeout than rdap.ts/favicon.ts's 6000ms -- crt.sh is a shared, sometimes-slow
      // Postgres-backed service, not a quick lookup.
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Array<{ name_value?: string }>;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function queryCtLog(brandRoot: string): Promise<string[] | null> {
  try {
    const rows = await fetchCtRows(brandRoot);

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
  } catch (err: any) {
    // Network error, timeout, non-2xx, or malformed JSON -- skip this round, the next
    // scheduled tick tries again. Logged (not alerted): one failure is normal for crt.sh;
    // a day of them shows up as ct_log "stale" on /health/jobs.
    console.warn(`[ct-log] crt.sh query for "${brandRoot}" failed: ${err?.message ?? err}`);
    return null;
  }
}
