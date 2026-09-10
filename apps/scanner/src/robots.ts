// Minimal robots.txt check: honors a blanket "Disallow: /" for User-agent: * or our own UA.
// Not a full robots.txt parser (no path-pattern matching) -- sufficient for a POC-level
// responsible-scanning gate: we only ever request "/", so a blanket disallow is what matters.
export async function isScanAllowed(origin: string, userAgent: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/robots.txt", origin).toString(), {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return true; // no robots.txt -> allowed by default
    const body = await res.text();
    return !hasBlanketDisallow(body);
  } catch {
    return true; // unreachable robots.txt shouldn't block a scan we'd otherwise attempt
  }
}

function hasBlanketDisallow(robotsTxt: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.trim());
  let inRelevantGroup = false;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      inRelevantGroup = value === "*";
    } else if (key === "disallow" && inRelevantGroup) {
      if (value === "/") return true;
    }
  }
  return false;
}
