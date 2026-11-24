import type { Prisma } from "@prisma/client";
import type { Channel } from "./reportTemplates";
import { isCloudflareHost } from "./cloudflareAbuse";

// Who a takedown report goes to (TAKEDOWN_AUTOMATION_PLAN.md §3). Order:
//   1. the contact book: the most specific enabled rule for this channel that matches the finding,
//      across the platform's book and the org's (the org's wins a tie);
//   2. else the abuse contact in the registry record (registrar: domain RDAP/WHOIS; host: IP RDAP);
//   3. else nobody: the report becomes a manual task. Never a guess.
// Then the org's fixed recipients for the channel are added, and the safety rules remove anything
// that must never get a report. Pure functions; loadRoutingData() reads the tables.

export const MATCH_TYPES = ["iana_id", "name", "tld", "any"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];
export const METHODS = ["email", "form", "skip"] as const;
export type Method = (typeof METHODS)[number];

export interface ContactRule {
  id: string;
  layer: "org" | "platform";
  channel: string;
  matchType: string;
  matchValue: string;
  method: string;
  emails: string[];
  formUrl: string | null;
  instructions: string | null;
  language: string | null;
  enabled: boolean;
}

export interface FindingFacts {
  domain: string;
  registrarName: string | null;
  registrarIanaId: string | null;
  hostingOrg: string | null;
  registrarAbuseEmail: string | null;
  hostingAbuseEmail: string | null;
}

export interface FixedRecipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

export interface BlockedEntry {
  value: string;
  expiresAt: Date | null;
}

export interface Routing {
  // api: submitted through a provider's report API (Cloudflare; lib/cloudflareAbuse.ts), no email.
  method: "email" | "form" | "skip" | "none" | "api";
  apiProvider?: "cloudflare";
  to: string[];
  cc: string[];
  bcc: string[];
  forms: Array<{ url: string; instructions: string | null }>;
  language: string | null;
  source:
    | { kind: "contact"; layer: "org" | "platform"; ruleId: string; matchType: string; matchValue: string }
    | { kind: "registry" }
    | { kind: "none" };
  why: string;
  // Addresses the safety rules took out, and why.
  removed: Array<{ address: string; reason: RecipientProblem["reason"] }>;
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeMatchValue(matchType: string, value: string): string {
  const v = value.trim().toLowerCase();
  if (matchType === "name") return normalizeName(v);
  if (matchType === "tld") return v.replace(/^\.+/, "");
  if (matchType === "any") return "*";
  return v;
}

function ruleMatches(rule: ContactRule, channel: Channel, f: FindingFacts): boolean {
  if (!rule.enabled || rule.channel !== channel) return false;
  switch (rule.matchType) {
    case "iana_id":
      return channel === "registrar" && !!f.registrarIanaId && f.registrarIanaId === rule.matchValue;
    case "name": {
      const name = channel === "registrar" ? f.registrarName : channel === "host" ? f.hostingOrg : null;
      return !!name && !!rule.matchValue && normalizeName(name).includes(rule.matchValue);
    }
    case "tld": {
      const d = f.domain.toLowerCase();
      return !!rule.matchValue && (d === rule.matchValue || d.endsWith(`.${rule.matchValue}`));
    }
    case "any":
      return true;
    default:
      return false;
  }
}

// Higher = more specific. A longer name or a longer TLD suffix is more specific than a shorter one;
// the org's own rule beats the platform's at equal specificity.
export function specificity(rule: ContactRule): number {
  const base = { iana_id: 4000, name: 3000, tld: 2000, any: 1000 }[rule.matchType as MatchType] ?? 0;
  const detail = rule.matchType === "name" ? Math.min(rule.matchValue.length, 99) * 10 : rule.matchType === "tld" ? rule.matchValue.split(".").length * 10 : 0;
  return base + detail + (rule.layer === "org" ? 1 : 0);
}

const domainOf = (address: string) => address.split("@")[1]?.toLowerCase() ?? "";
const underDomain = (d: string, parent: string) => d === parent || d.endsWith(`.${parent}`);

export interface RecipientProblem {
  field: "to" | "cc" | "bcc";
  address: string;
  reason: "own_domain" | "blocked";
}

// The org's own domains never receive a report as its addressee (To) -- that would mean reporting
// yourself; copies (Cc/Bcc) to your own people are fine. The never-send-to list applies everywhere.
export function recipientProblems(r: FixedRecipients, ownDomains: string[], blocked: BlockedEntry[], now = new Date()): RecipientProblem[] {
  const active = blocked.filter((b) => !b.expiresAt || b.expiresAt > now).map((b) => b.value.toLowerCase());
  const isBlocked = (a: string) => active.some((v) => (v.startsWith("@") ? underDomain(domainOf(a), v.slice(1)) : v === a.toLowerCase()));
  const problems: RecipientProblem[] = [];
  for (const field of ["to", "cc", "bcc"] as const) {
    for (const address of r[field]) {
      if (isBlocked(address)) problems.push({ field, address, reason: "blocked" });
      else if (field === "to" && ownDomains.some((d) => underDomain(domainOf(address), d.toLowerCase()))) problems.push({ field, address, reason: "own_domain" });
    }
  }
  return problems;
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean))];

export function resolveRouting(
  channel: Channel,
  facts: FindingFacts,
  rules: ContactRule[],
  fixed: FixedRecipients | null,
  ownDomains: string[],
  blocked: BlockedEntry[],
  now = new Date(),
  // Report APIs the org has connected and tested (e.g. ["cloudflare"]).
  apis: string[] = []
): Routing {
  const matching = rules.filter((r) => ruleMatches(r, channel, facts)).sort((a, b) => specificity(b) - specificity(a));
  const empty = { to: [], cc: [], bcc: [], forms: [], language: null, removed: [] };

  // Blocklists: every matching web form (Safe Browsing, Netcraft, ...), unless a more specific rule says skip.
  if (channel === "blocklist") {
    if (matching[0]?.method === "skip") return { ...empty, method: "skip", source: contactSource(matching[0]), why: describe(matching[0], "says not to report here") };
    const forms = [...new Map(matching.filter((r) => r.method === "form" && r.formUrl).map((r) => [r.formUrl!, { url: r.formUrl!, instructions: r.instructions }])).values()];
    return forms.length
      ? { ...empty, method: "form", forms, source: contactSource(matching[0]), why: `${forms.length} blocklist web form${forms.length > 1 ? "s" : ""} from the contact book.` }
      : { ...empty, method: "none", source: { kind: "none" }, why: "No blocklist forms in the contact book." };
  }

  const best = matching[0];
  let routing: Routing;
  // A site behind Cloudflare, and the org has Cloudflare's report API connected: use it rather
  // than the web form (unless a rule says not to report to this host at all).
  if (channel === "host" && apis.includes("cloudflare") && isCloudflareHost(facts.hostingOrg) && best?.method !== "skip") {
    return { ...empty, method: "api", apiProvider: "cloudflare", source: { kind: "none" }, why: "Submitted through Cloudflare's abuse-reports API (your Cloudflare connection)." };
  }
  if (best?.method === "skip") {
    routing = { ...empty, method: "skip", source: contactSource(best), why: describe(best, "says not to report through this channel") };
  } else if (best?.method === "form" && best.formUrl) {
    routing = { ...empty, method: "form", forms: [{ url: best.formUrl, instructions: best.instructions }], language: best.language, source: contactSource(best), why: describe(best, "takes reports by web form only") };
  } else if (best?.method === "email" && best.emails.length) {
    routing = { ...empty, method: "email", to: uniq(best.emails), language: best.language, source: contactSource(best), why: describe(best, "gives the address") };
  } else {
    const registry = channel === "registrar" ? facts.registrarAbuseEmail : channel === "host" ? facts.hostingAbuseEmail : null;
    routing = registry
      ? {
          ...empty,
          method: "email",
          to: uniq([registry]),
          source: { kind: "registry" },
          why: channel === "registrar" ? "The registrar's abuse contact in the domain's registry record (RDAP/WHOIS)." : "The abuse contact in the registry record of the site's IP address.",
        }
      : {
          ...empty,
          method: "none",
          source: { kind: "none" },
          why:
            channel === "cert"
              ? "No national CERT in the contact book: add one under Settings → Report recipients."
              : channel === "registrar"
                ? "No abuse contact found for the registrar. Find it with ICANN Lookup (lookup.icann.org) and add it to the contact book."
                : "No abuse contact found for the host. Find it on the host's website and add it to the contact book.",
        };
  }

  if (routing.method === "email" && fixed) {
    routing.to = uniq([...routing.to, ...fixed.to]);
    routing.cc = uniq(fixed.cc);
    routing.bcc = uniq(fixed.bcc);
  }

  const problems = recipientProblems(routing, ownDomains, blocked, now);
  if (problems.length) {
    const bad = new Set(problems.map((p) => `${p.field}:${p.address}`));
    for (const field of ["to", "cc", "bcc"] as const) routing[field] = routing[field].filter((a) => !bad.has(`${field}:${a}`));
    routing.removed = problems.map((p) => ({ address: p.address, reason: p.reason }));
    if (routing.method === "email" && routing.to.length === 0) {
      routing.method = "none";
      routing.why += " Every address was removed by the safety rules, so this needs a manual decision.";
    }
  }
  return routing;
}

function contactSource(r: ContactRule): Routing["source"] {
  return { kind: "contact", layer: r.layer, ruleId: r.id, matchType: r.matchType, matchValue: r.matchValue };
}

function describe(r: ContactRule, what: string): string {
  const layer = r.layer === "org" ? "Your contact book" : "The platform contact book";
  const match = r.matchType === "any" ? "for every report on this channel" : r.matchType === "iana_id" ? `for IANA ID ${r.matchValue}` : r.matchType === "tld" ? `for .${r.matchValue} domains` : `for names containing "${r.matchValue}"`;
  return `${layer} ${what} (${match}).`;
}

// Where a report is actually delivered. Redirect (test) mode sends everything to one address of
// the org's instead; the real recipients stay on the report.
export function deliveryRecipients(r: FixedRecipients, redirectTo: string | null): FixedRecipients & { redirected: boolean } {
  return redirectTo ? { to: [redirectTo], cc: [], bcc: [], redirected: true } : { ...r, redirected: false };
}

export interface RoutingData {
  rules: ContactRule[];
  fixed: Map<string, FixedRecipients>;
  blocked: BlockedEntry[];
  ownDomains: string[];
  redirectTo: string | null;
  apis: string[];
}

// Everything routing needs for one org, inside withTenant (the platform book is readable by the app role).
export async function loadRoutingData(tx: Prisma.TransactionClient, orgId: string): Promise<RoutingData> {
  const [orgRules, platformRules, settings, blocked, brands, automation, sender, integrations] = await Promise.all([
    tx.takedownContact.findMany({ where: { organizationId: orgId } }),
    tx.takedownPlatformContact.findMany(),
    tx.takedownChannelSetting.findMany({ where: { organizationId: orgId } }),
    tx.takedownBlockedRecipient.findMany({ where: { organizationId: orgId } }),
    tx.brand.findMany({ where: { organizationId: orgId }, select: { primaryDomain: true, domains: { select: { domain: true } } } }),
    tx.takedownAutomation.findUnique({ where: { organizationId: orgId }, select: { redirectTo: true } }),
    tx.takedownSender.findUnique({ where: { organizationId: orgId }, select: { fromAddress: true } }),
    tx.takedownIntegration.findMany({ where: { organizationId: orgId, enabled: true, lastTestOk: true }, select: { provider: true } }),
  ]);
  const ownDomains = uniq([
    ...brands.flatMap((b) => [b.primaryDomain, ...b.domains.map((d) => d.domain)]),
    ...(sender ? [domainOf(sender.fromAddress)] : []),
  ]);
  return {
    rules: [...orgRules.map((r) => ({ ...r, layer: "org" as const })), ...platformRules.map((r) => ({ ...r, layer: "platform" as const }))],
    fixed: new Map(settings.map((s) => [s.channel, { to: s.to, cc: s.cc, bcc: s.bcc }])),
    blocked,
    ownDomains,
    redirectTo: automation?.redirectTo ?? null,
    apis: integrations.map((i) => i.provider),
  };
}
