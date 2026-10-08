import { SCANNER_USER_AGENT } from "@brand-monitor/shared";

export interface RegistrationInfo {
  registrar: string | null;
  registeredAt: string | null;
  // The registry's "last changed" / WHOIS "Updated Date" -- bumps on any registrar-side
  // edit (nameservers, contacts, status, renewal). This is how a dormant domain being
  // re-armed after a takedown shows up before any website does.
  lastChangedAt: string | null;
  expiresAt: string | null;
  // EPP status codes, normalized to their camelCase form (see normalizeStatusCode) so
  // RDAP's "client hold" and WHOIS's "clientHold https://icann.org/epp#clientHold" compare
  // equal. clientHold/serverHold = suspended, i.e. what a successful registrar takedown
  // looks like.
  statusCodes: string[];
  registrarAbuseEmail: string | null;
  registrarAbusePhone: string | null;
  nameservers: string[];
  source: "rdap" | "whois" | "unavailable";
  raw: unknown;
}

// Without an explicit User-Agent rdap.org returns 403 (an HTML block page) to Node's
// fetch -- curl works, which hid this. Every production lookup silently fell back to
// WHOIS until 2026-10-08.
const RDAP_HEADERS = { Accept: "application/rdap+json", "User-Agent": SCANNER_USER_AGENT };

const RDAP_STATUS_ALIASES: Record<string, string> = { active: "ok" };

export function normalizeStatusCode(raw: string): string {
  const cleaned = raw.replace(/\(?https?:\/\/\S+\)?/g, "").trim();
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/);
  if (words.length === 1) {
    const w = words[0];
    return RDAP_STATUS_ALIASES[w.toLowerCase()] ?? w.charAt(0).toLowerCase() + w.slice(1);
  }
  const camel = words.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join("");
  return RDAP_STATUS_ALIASES[camel.toLowerCase()] ?? camel;
}

export function isOnHold(statusCodes: string[]): boolean {
  return statusCodes.some((s) => s === "clientHold" || s === "serverHold");
}

function vcardValue(entity: any, field: string): string | null {
  const entry = entity?.vcardArray?.[1]?.find((f: any) => f[0] === field);
  const value = entry?.[3];
  return typeof value === "string" && value ? value : null;
}

function eventDate(data: any, action: string): string | null {
  return (data.events ?? []).find((e: any) => e.eventAction === action)?.eventDate ?? null;
}

// Split from lookupRdap so it can be unit-tested against a saved response.
export function parseRdapDomain(data: any): RegistrationInfo {
  const registrarEntity = (data.entities ?? []).find((e: any) => (e.roles ?? []).includes("registrar"));
  const registrar = vcardValue(registrarEntity, "fn") ?? registrarEntity?.handle ?? null;
  const abuseEntity = (registrarEntity?.entities ?? []).find((e: any) => (e.roles ?? []).includes("abuse"));
  const abusePhone = vcardValue(abuseEntity, "tel");

  const nameservers: string[] = (data.nameservers ?? []).map((ns: any) => ns.ldhName).filter(Boolean);

  return {
    registrar,
    registeredAt: eventDate(data, "registration"),
    lastChangedAt: eventDate(data, "last changed"),
    expiresAt: eventDate(data, "expiration"),
    statusCodes: (data.status ?? []).map((s: string) => normalizeStatusCode(String(s))).filter(Boolean),
    registrarAbuseEmail: vcardValue(abuseEntity, "email"),
    registrarAbusePhone: abusePhone ? abusePhone.replace(/^tel:/, "") : null,
    nameservers,
    source: "rdap",
    raw: data,
  };
}

// rdap.org is a public convenience redirector that follows IANA's RDAP bootstrap registry
// to the right RDAP server for a TLD. Free, no key, JSON. Coverage is good for gTLDs and
// spotty-to-absent for many ccTLDs (e.g. .co.ke) -- that's expected, not a bug; callers
// should fall back to WHOIS (see whois.ts) when this returns null.
export async function lookupRdap(domain: string): Promise<RegistrationInfo | null> {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, { headers: RDAP_HEADERS, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return parseRdapDomain(await res.json());
  } catch {
    return null;
  }
}

export interface HostingInfo {
  org: string | null;
  abuseEmail: string | null;
}

export function parseRdapIp(data: any): HostingInfo {
  const entities: any[] = data.entities ?? [];
  // The network's owner is usually the "registrant" entity; its abuse contact is a child
  // entity (ARIN) or a sibling top-level entity (RIPE/AFRINIC) depending on the RIR.
  const owner = entities.find((e) => (e.roles ?? []).includes("registrant")) ?? entities[0];
  const all = [...entities, ...entities.flatMap((e) => e.entities ?? [])];
  const abuse = all.find((e) => (e.roles ?? []).includes("abuse"));
  return {
    org: vcardValue(owner, "fn") ?? data.name ?? null,
    abuseEmail: vcardValue(abuse, "email"),
  };
}

// Who hosts the IP -- the second party to send a takedown to, alongside the registrar.
// ~6 KB per call, so recheckJob.ts only calls it when the domain's IP changes.
export async function lookupIpRdap(ip: string): Promise<HostingInfo | null> {
  try {
    const res = await fetch(`https://rdap.org/ip/${ip}`, { headers: RDAP_HEADERS, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return parseRdapIp(await res.json());
  } catch {
    return null;
  }
}
