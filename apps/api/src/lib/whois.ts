import whoiser from "whoiser";
import type { RegistrationInfo } from "./rdap";

const DATE_KEYS = ["Created Date", "Creation Date", "created", "Domain Registration Date"];
const REGISTRAR_KEYS = ["Registrar", "registrar", "Sponsoring Registrar"];
const NS_KEYS = ["Name Server", "Name Servers", "nameServers", "nserver"];

function firstMatchingValue(obj: Record<string, any>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (!value) continue;
    return Array.isArray(value) ? value[0] : String(value);
  }
  return null;
}

function collectNameservers(obj: Record<string, any>): string[] {
  for (const key of NS_KEYS) {
    const value = obj[key];
    if (!value) continue;
    return Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return [];
}

// Fallback for TLDs with no RDAP coverage (common for African/smaller ccTLDs). whoiser
// queries legacy port-43 WHOIS text and its field naming varies a lot per registry --
// this is intentionally best-effort. A miss here just means "age signal unavailable"
// for this candidate, not a pipeline failure (see runPipeline.ts).
export async function lookupWhois(domain: string): Promise<RegistrationInfo | null> {
  try {
    const result: any = await whoiser(domain, { follow: 2, timeout: 6000 });
    const records = Object.values(result) as Record<string, any>[];
    const merged = records.reduce((acc, r) => ({ ...acc, ...r }), {} as Record<string, any>);

    const registeredAt = firstMatchingValue(merged, DATE_KEYS);
    const registrar = firstMatchingValue(merged, REGISTRAR_KEYS);
    const nameservers = collectNameservers(merged);

    if (!registeredAt && !registrar && nameservers.length === 0) return null;

    return {
      registrar,
      registeredAt: registeredAt ? new Date(registeredAt).toISOString() : null,
      nameservers,
      source: "whois",
      raw: result,
    };
  } catch {
    return null;
  }
}
