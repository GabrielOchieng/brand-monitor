import type { RegistrationInfo } from "../lib/rdap";

export interface PreviousRegistration {
  registrar: string | null;
  nameservers: string[];
  whoisSource: string | null;
  lastChangedAt: Date | null;
  expiresAt: Date | null;
  statusCodes: string[];
  aRecords: string[];
}

export interface RegistrationChange {
  field: "registrar" | "nameservers" | "last_changed" | "expires" | "status" | "ip";
  oldValue: string;
  newValue: string;
  // Whether this change alone should alert (registration_changed rule). IP and expiry are
  // recorded but don't alert: CDN-hosted sites rotate IPs, and a renewal also bumps
  // last_changed, which does alert.
  alert: boolean;
}

function normalizeNameservers(ns: string[]): string[] {
  return [...new Set(ns.map((n) => n.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean))].sort();
}

function sameSecond(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / 1000) === Math.floor(b.getTime() / 1000);
}

function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  return a.length === b.length && b.every((x) => sa.has(x));
}

// Compares only facts known on BOTH sides -- a field that was or is missing (lookup failed,
// registry doesn't publish it, or the column didn't exist yet) is never a "change". Registrar
// name, dates and status codes are compared only when both readings came from the same
// source: RDAP and WHOIS spell registrar names differently ("Tucows Domains Inc." vs
// "TUCOWS.COM, CO.") and publish different subsets of status codes, so a source switch
// would otherwise look like a change. Nameservers are normalized and compared regardless.
export function diffRegistration(
  prev: PreviousRegistration | null,
  next: RegistrationInfo | null,
  nextARecords: string[]
): RegistrationChange[] {
  if (!prev) return [];
  const changes: RegistrationChange[] = [];

  if (next) {
    const prevNs = normalizeNameservers(prev.nameservers);
    const nextNs = normalizeNameservers(next.nameservers);
    if (prevNs.length > 0 && nextNs.length > 0 && !sameSet(prevNs, nextNs)) {
      changes.push({ field: "nameservers", oldValue: prevNs.join(", "), newValue: nextNs.join(", "), alert: true });
    }

    if (prev.whoisSource === next.source) {
      if (prev.registrar && next.registrar && prev.registrar.trim().toLowerCase() !== next.registrar.trim().toLowerCase()) {
        changes.push({ field: "registrar", oldValue: prev.registrar, newValue: next.registrar, alert: true });
      }
      if (prev.lastChangedAt && next.lastChangedAt && !sameSecond(prev.lastChangedAt, new Date(next.lastChangedAt))) {
        changes.push({ field: "last_changed", oldValue: prev.lastChangedAt.toISOString(), newValue: new Date(next.lastChangedAt).toISOString(), alert: true });
      }
      if (prev.expiresAt && next.expiresAt && !sameSecond(prev.expiresAt, new Date(next.expiresAt))) {
        changes.push({ field: "expires", oldValue: prev.expiresAt.toISOString(), newValue: new Date(next.expiresAt).toISOString(), alert: false });
      }
      if (prev.statusCodes.length > 0 && next.statusCodes.length > 0 && !sameSet(prev.statusCodes, next.statusCodes)) {
        changes.push({ field: "status", oldValue: [...prev.statusCodes].sort().join(", "), newValue: [...next.statusCodes].sort().join(", "), alert: true });
      }
    }
  }

  // Disjoint, not merely different: a host with several A records can return them in a
  // different order or subset per lookup.
  if (prev.aRecords.length > 0 && nextARecords.length > 0 && !nextARecords.some((ip) => prev.aRecords.includes(ip))) {
    changes.push({ field: "ip", oldValue: [...prev.aRecords].sort().join(", "), newValue: [...nextARecords].sort().join(", "), alert: false });
  }

  return changes;
}

// "site" is the post-takedown reactivation entry recheckJob.ts writes alongside these.
const FIELD_LABELS: Record<string, string> = {
  registrar: "Registrar",
  nameservers: "Nameservers",
  last_changed: "Registration updated",
  expires: "Expiry",
  status: "Registry status",
  ip: "IP",
  site: "Website",
};

export function describeChange(change: { field: string; oldValue: string | null; newValue: string | null }): string {
  const label = FIELD_LABELS[change.field] ?? change.field;
  return `${label}: ${change.oldValue ?? "—"} → ${change.newValue ?? "—"}`;
}
