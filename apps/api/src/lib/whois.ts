import whoiser from "whoiser";
import { normalizeStatusCode, type RegistrationInfo } from "./rdap";

const DATE_KEYS = ["Created Date", "Creation Date", "created", "Domain Registration Date"];
const UPDATED_KEYS = ["Updated Date", "Last Updated", "last-update", "changed", "Last Modified"];
const EXPIRY_KEYS = ["Registry Expiry Date", "Registrar Registration Expiration Date", "Expiry Date", "Expiration Date", "expires", "paid-till"];
const STATUS_KEYS = ["Domain Status", "Status", "status"];
const ABUSE_EMAIL_KEYS = ["Registrar Abuse Contact Email"];
const ABUSE_PHONE_KEYS = ["Registrar Abuse Contact Phone"];
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

function allMatchingValues(obj: Record<string, any>, keys: string[]): string[] {
  for (const key of keys) {
    const value = obj[key];
    if (!value) continue;
    return Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return [];
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
    const nameservers = allMatchingValues(merged, NS_KEYS);

    if (!registeredAt && !registrar && nameservers.length === 0) return null;

    return {
      registrar,
      registeredAt: toIso(registeredAt),
      lastChangedAt: toIso(firstMatchingValue(merged, UPDATED_KEYS)),
      expiresAt: toIso(firstMatchingValue(merged, EXPIRY_KEYS)),
      statusCodes: [...new Set(allMatchingValues(merged, STATUS_KEYS).map(normalizeStatusCode).filter(Boolean))],
      registrarAbuseEmail: firstMatchingValue(merged, ABUSE_EMAIL_KEYS),
      registrarAbusePhone: firstMatchingValue(merged, ABUSE_PHONE_KEYS),
      nameservers,
      source: "whois",
      raw: result,
    };
  } catch {
    return null;
  }
}
