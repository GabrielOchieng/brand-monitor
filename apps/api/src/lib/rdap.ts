export interface RegistrationInfo {
  registrar: string | null;
  registeredAt: string | null;
  nameservers: string[];
  source: "rdap" | "whois" | "unavailable";
  raw: unknown;
}

// rdap.org is a public convenience redirector that follows IANA's RDAP bootstrap registry
// to the right RDAP server for a TLD. Free, no key, JSON. Coverage is good for gTLDs and
// spotty-to-absent for many ccTLDs (e.g. .co.ke) -- that's expected, not a bug; callers
// should fall back to WHOIS (see whois.ts) when this returns null.
export async function lookupRdap(domain: string): Promise<RegistrationInfo | null> {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      headers: { Accept: "application/rdap+json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();

    const registrarEntity = (data.entities ?? []).find((e: any) =>
      (e.roles ?? []).includes("registrar")
    );
    const registrar =
      registrarEntity?.vcardArray?.[1]?.find((f: any) => f[0] === "fn")?.[3] ??
      registrarEntity?.handle ??
      null;

    const registrationEvent = (data.events ?? []).find(
      (e: any) => e.eventAction === "registration"
    );

    const nameservers: string[] = (data.nameservers ?? [])
      .map((ns: any) => ns.ldhName)
      .filter(Boolean);

    return {
      registrar,
      registeredAt: registrationEvent?.eventDate ?? null,
      nameservers,
      source: "rdap",
      raw: data,
    };
  } catch {
    return null;
  }
}
