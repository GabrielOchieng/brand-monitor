// Report templates for automatic takedown reporting (TAKEDOWN_AUTOMATION_PLAN.md §5, §8): the
// placeholders, the locked blocks every report must keep, validation, rendering, and the built-in
// texts used until an org publishes its own. Pure functions: the data comes from reportContext.ts.

export const CHANNELS = ["registrar", "host", "cert", "blocklist"] as const;
export type Channel = (typeof CHANNELS)[number];
export const KINDS = ["first", "follow_up", "escalation"] as const;
export type Kind = (typeof KINDS)[number];

// Which message kinds each channel has. Escalation = writing to the next channel because the
// earlier one didn't act; blocklists only ever get one report.
export const CHANNEL_KINDS: Record<Channel, Kind[]> = {
  registrar: ["first", "follow_up"],
  host: ["first", "follow_up", "escalation"],
  cert: ["first", "follow_up", "escalation"],
  blocklist: ["first"],
};

export const LANGUAGES = ["en", "fr", "es", "pt", "de", "sw", "ar", "zh", "ru"] as const;

export interface ReportContext {
  finding: { url: string; domain: string; firstDetectedAt: Date };
  brand: { name: string; officialDomain: string };
  registrar: { name: string | null; ianaId: string | null };
  registeredAt: Date | null;
  nameservers: string[];
  ip: string | null;
  hostingOrg: string | null;
  lastChecked: { at: Date; live: boolean } | null;
  reasons: string[];
  indicators: Array<{ kind: string; value: string }>;
  screenshotUrl: string | null;
  org: { name: string; details: string | null; disclaimer: string | null };
  signature: string | null;
  signatory: { name: string; title: string; email: string } | null;
  reportRef: string;
  // The earlier report a follow-up or escalation refers to. Filled in once reports are sent.
  previous: { sentAt: Date | null; ticketRef: string | null } | null;
}

export interface PlaceholderInfo {
  name: string;
  description: string;
}

// Locked: a template can't be saved without these (subject: reportRef; body: evidence, signature).
export const LOCKED_SUBJECT = ["reportRef"];
export const LOCKED_BODY = ["evidence", "signature"];

export const PLACEHOLDERS: PlaceholderInfo[] = [
  { name: "reportRef", description: "The report's reference tag, e.g. [BM-7KQ2X9TD]. Required in the subject: replies are matched by it." },
  { name: "evidence", description: "The evidence block: URL, why it's fraudulent, registration, timeline, contact details, screenshot. Required." },
  { name: "signature", description: "Your signature, who authorizes the report, and your company details. Required." },
  { name: "finding.url", description: "The full reported URL" },
  { name: "domain", description: "The reported domain" },
  { name: "domain.defanged", description: "The domain made unclickable, e.g. example[.]com (for subjects)" },
  { name: "brand.name", description: "Your brand's name" },
  { name: "brand.officialDomain", description: "Your brand's real domain" },
  { name: "registrar.name", description: "The registrar's name" },
  { name: "registrar.ianaId", description: "The registrar's IANA ID" },
  { name: "registeredAt", description: "Date the domain was registered" },
  { name: "nameservers", description: "The domain's nameservers" },
  { name: "ip", description: "The site's IP address" },
  { name: "hostingOrg", description: "The hosting provider" },
  { name: "firstSeenUtc", description: "When monitoring first saw it (UTC)" },
  { name: "lastCheckedUtc", description: "When it was last checked (UTC)" },
  { name: "reasons", description: "Why it's fraudulent, as a list" },
  { name: "indicators", description: "Phone numbers, payment accounts etc. the scam uses, as a list" },
  { name: "screenshotUrl", description: "Link to the latest screenshot" },
  { name: "org.name", description: "Your organization's name" },
  { name: "org.details", description: "Your company details (set under Report templates)" },
  { name: "disclaimer", description: "Your legal disclaimer (set under Report templates)" },
  { name: "signatory.name", description: "Who authorizes the report" },
  { name: "signatory.title", description: "Their title" },
  { name: "previous.sentAt", description: "Date of the earlier report (follow-ups and escalations)" },
  { name: "previous.ticketRef", description: "Ticket number the recipient gave the earlier report" },
];
const KNOWN = new Set(PLACEHOLDERS.map((p) => p.name));

export const MAX_SUBJECT = 300;
export const MAX_BODY = 20_000;

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][A-Za-z.]*)\s*\}\}/g;

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
}

export interface TemplateText {
  subject: string;
  body: string;
}

// Problems that stop a template being saved, in plain words for the editor.
export function validateTemplate(t: TemplateText, channel: Channel): string[] {
  const errors: string[] = [];
  if (t.subject.length > MAX_SUBJECT) errors.push(`The subject is longer than ${MAX_SUBJECT} characters.`);
  if (t.body.length > MAX_BODY) errors.push(`The body is longer than ${MAX_BODY} characters.`);
  if (/[\r\n]/.test(t.subject)) errors.push("The subject must be one line.");
  if (!t.body.trim()) errors.push("The body is empty.");

  const unknown = [...new Set([...placeholdersIn(t.subject), ...placeholdersIn(t.body)].filter((p) => !KNOWN.has(p)))];
  for (const u of unknown) errors.push(`Unknown placeholder {{${u}}}.`);
  // Stray braces that look like a mistyped placeholder.
  const stray = (t.subject + t.body).replace(PLACEHOLDER_RE, "").match(/\{\{|\}\}/);
  if (stray) errors.push("There are {{ or }} that aren't part of a placeholder.");

  const count = (text: string, name: string) => placeholdersIn(text).filter((p) => p === name).length;
  for (const name of LOCKED_BODY) {
    if (name === "signature" && channel === "blocklist") continue; // web-form text: no signature needed
    if (count(t.body, name) !== 1) errors.push(`The body must contain {{${name}}} exactly once.`);
  }
  if (channel !== "blocklist") {
    for (const name of LOCKED_SUBJECT) if (count(t.subject, name) !== 1) errors.push(`The subject must contain {{${name}}} exactly once.`);
  }
  for (const name of ["evidence", "signature", "reasons", "indicators"]) {
    if (count(t.subject, name) > 0) errors.push(`{{${name}}} is a block of several lines and can't go in the subject.`);
  }
  return errors;
}

const utc = (d: Date | null) => (d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "unknown");
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "unknown");

const INDICATOR_LABELS: Record<string, string> = {
  phone: "Phone",
  whatsapp: "WhatsApp",
  mpesa_paybill: "M-Pesa paybill",
  mpesa_till: "M-Pesa till",
  email: "Email",
  telegram: "Telegram",
  crypto_wallet: "Crypto wallet",
};

export function defang(domain: string): string {
  return domain.replace(/\./g, "[.]");
}

export function evidenceBlock(c: ReportContext): string {
  const lines: string[] = [];
  lines.push(`Reported site: ${c.finding.url}`);
  lines.push(`Domain: ${c.finding.domain}`);
  lines.push(`Imitates: ${c.brand.name} (official site: https://${c.brand.officialDomain})`);
  if (c.reasons.length) {
    lines.push("", "Why it is fraudulent:");
    for (const r of c.reasons) lines.push(`- ${r}`);
  }
  const reg: string[] = [];
  if (c.registrar.name) reg.push(`- Registrar: ${c.registrar.name}${c.registrar.ianaId ? ` (IANA ID ${c.registrar.ianaId})` : ""}`);
  if (c.registeredAt) reg.push(`- Registered: ${day(c.registeredAt)}`);
  if (c.nameservers.length) reg.push(`- Nameservers: ${c.nameservers.join(", ")}`);
  if (c.ip) reg.push(`- IP address: ${c.ip}${c.hostingOrg ? ` (${c.hostingOrg})` : ""}`);
  if (reg.length) lines.push("", "Registration and hosting:", ...reg);
  lines.push("", "Timeline (UTC):", `- First seen by our monitoring: ${utc(c.finding.firstDetectedAt)}`);
  if (c.lastChecked) lines.push(`- Last checked: ${utc(c.lastChecked.at)}${c.lastChecked.live ? " (site live)" : ""}`);
  if (c.indicators.length) {
    lines.push("", "Contact and payment details the scammers use:");
    for (const i of c.indicators) lines.push(`- ${INDICATOR_LABELS[i.kind] ?? i.kind}: ${i.value}`);
  }
  if (c.screenshotUrl) lines.push("", `Screenshot: ${c.screenshotUrl}`);
  return lines.join("\n");
}

export function signatureBlock(c: ReportContext): string {
  const lines: string[] = [c.signature?.trim() || "[No signature yet: add one to the sender mailbox under Settings → Automatic reporting]"];
  if (c.signatory) {
    lines.push("", `This report is made on behalf of ${c.org.name}, authorized by ${c.signatory.name}, ${c.signatory.title} (${c.signatory.email}).`);
  }
  if (c.org.details?.trim()) lines.push("", c.org.details.trim());
  return lines.join("\n");
}

function values(c: ReportContext): Record<string, string> {
  return {
    reportRef: `[${c.reportRef}]`,
    evidence: evidenceBlock(c),
    signature: signatureBlock(c),
    "finding.url": c.finding.url,
    domain: c.finding.domain,
    "domain.defanged": defang(c.finding.domain),
    "brand.name": c.brand.name,
    "brand.officialDomain": c.brand.officialDomain,
    "registrar.name": c.registrar.name ?? "registrar",
    "registrar.ianaId": c.registrar.ianaId ?? "unknown",
    registeredAt: day(c.registeredAt),
    nameservers: c.nameservers.join(", ") || "unknown",
    ip: c.ip ?? "unknown",
    hostingOrg: c.hostingOrg ?? "hosting provider",
    firstSeenUtc: utc(c.finding.firstDetectedAt),
    lastCheckedUtc: utc(c.lastChecked?.at ?? null),
    reasons: c.reasons.map((r) => `- ${r}`).join("\n"),
    indicators: c.indicators.map((i) => `- ${INDICATOR_LABELS[i.kind] ?? i.kind}: ${i.value}`).join("\n"),
    screenshotUrl: c.screenshotUrl ?? "(no screenshot)",
    "org.name": c.org.name,
    "org.details": c.org.details?.trim() ?? "",
    disclaimer: c.org.disclaimer?.trim() ?? "",
    "signatory.name": c.signatory?.name ?? "[authorized signatory]",
    "signatory.title": c.signatory?.title ?? "[title]",
    "previous.sentAt": c.previous?.sentAt ? day(c.previous.sentAt) : "[date of our first report]",
    "previous.ticketRef": c.previous?.ticketRef ?? "none received",
  };
}

// Placeholders are replaced in one pass, so text that came from the finding (a page title, a
// reason) can never be read as another placeholder.
export function renderTemplate(t: TemplateText, c: ReportContext): TemplateText {
  const v = values(c);
  const fill = (text: string) => text.replace(PLACEHOLDER_RE, (whole, name: string) => (name in v ? v[name] : whole));
  const body = fill(t.body)
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { subject: fill(t.subject).replace(/\s+/g, " ").trim(), body };
}

// --- Built-in texts ---------------------------------------------------------------------------
// Written for a non-specialist reader at an abuse desk (§13.3): what it is, the evidence, the
// one action asked for, who is asking. The disclaimer line renders empty when none is set.

const TAIL = "Please reply to this email with your ticket number. We can send anything else you need.\n\n{{signature}}\n\n{{disclaimer}}";

export const DEFAULT_TEMPLATES: Record<string, TemplateText> = {
  "registrar.first": {
    subject: "{{reportRef}} Fraud: {{domain.defanged}} impersonates {{brand.name}}",
    body: `Hello {{registrar.name}} abuse team,

We are reporting the domain {{domain}}, registered through you, which impersonates {{brand.name}} to defraud its customers.

{{evidence}}

Requested action: please suspend the domain (for example with clientHold) so it stops resolving. It exists only to impersonate {{brand.name}}, which breaches your registration agreement and acceptable-use policy.

${TAIL}`,
  },
  "registrar.follow_up": {
    subject: "{{reportRef}} Follow-up: {{domain.defanged}} still impersonates {{brand.name}}",
    body: `Hello {{registrar.name}} abuse team,

On {{previous.sentAt}} we reported the domain {{domain}} (your reference: {{previous.ticketRef}}). It is still active and still used to defraud {{brand.name}}'s customers.

{{evidence}}

Requested action: please suspend the domain (for example with clientHold), or tell us what more you need to act on this report.

${TAIL}`,
  },
  "host.first": {
    subject: "{{reportRef}} Fraud: {{domain.defanged}} impersonates {{brand.name}}",
    body: `Hello {{hostingOrg}} abuse team,

We are reporting {{finding.url}}, hosted on your network, which impersonates {{brand.name}} to defraud its customers.

{{evidence}}

Requested action: please remove this site and suspend the account behind it. The same operator may redeploy under a new name, so please also check the account for related sites.

${TAIL}`,
  },
  "host.follow_up": {
    subject: "{{reportRef}} Follow-up: {{domain.defanged}} still impersonates {{brand.name}}",
    body: `Hello {{hostingOrg}} abuse team,

On {{previous.sentAt}} we reported {{finding.url}} (your reference: {{previous.ticketRef}}). It is still online and still used to defraud {{brand.name}}'s customers.

{{evidence}}

Requested action: please remove the site and suspend the account, or tell us what more you need to act on this report.

${TAIL}`,
  },
  "host.escalation": {
    subject: "{{reportRef}} Fraud: {{domain.defanged}} impersonates {{brand.name}}",
    body: `Hello {{hostingOrg}} abuse team,

We are reporting {{finding.url}}, hosted on your network, which impersonates {{brand.name}} to defraud its customers. We reported the domain to its registrar ({{registrar.name}}) on {{previous.sentAt}}, and the site is still online. As its host, you can remove it while the domain stays registered.

{{evidence}}

Requested action: please remove this site and suspend the account behind it.

${TAIL}`,
  },
  "cert.first": {
    subject: "{{reportRef}} Fraudulent website impersonating {{brand.name}}: {{domain.defanged}}",
    body: `Hello,

We are reporting a website that impersonates {{brand.name}} to defraud its customers, and ask for your help with its takedown.

{{evidence}}

We are also reporting it to the domain's registrar and to the hosting provider. Please escalate as you see fit, and let us know if you need anything further.

{{signature}}

{{disclaimer}}`,
  },
  "cert.follow_up": {
    subject: "{{reportRef}} Follow-up: {{domain.defanged}} still impersonates {{brand.name}}",
    body: `Hello,

On {{previous.sentAt}} we reported this website (your reference: {{previous.ticketRef}}). It is still online and still used to defraud {{brand.name}}'s customers.

{{evidence}}

We would be grateful for any help with escalating it to the registrar or the host.

{{signature}}

{{disclaimer}}`,
  },
  "cert.escalation": {
    subject: "{{reportRef}} Unresolved: fraudulent website impersonating {{brand.name}}: {{domain.defanged}}",
    body: `Hello,

We reported this website to its registrar ({{registrar.name}}) and its hosting provider ({{hostingOrg}}) on {{previous.sentAt}}. It is still online and still used to defraud {{brand.name}}'s customers. We ask for your help with escalating it.

{{evidence}}

{{signature}}

{{disclaimer}}`,
  },
  "blocklist.first": {
    subject: "",
    body: `This site impersonates {{brand.name}} (official site: https://{{brand.officialDomain}}) to defraud its customers.

{{evidence}}`,
  },
};

export function defaultTemplate(channel: Channel, kind: Kind): TemplateText {
  return DEFAULT_TEMPLATES[`${channel}.${kind}`] ?? DEFAULT_TEMPLATES[`${channel}.first`];
}

export function isValidChannelKind(channel: string, kind: string): channel is Channel {
  return (CHANNELS as readonly string[]).includes(channel) && (CHANNEL_KINDS[channel as Channel] as string[]).includes(kind);
}

// [BM-XXXXXXXX]: 8 characters without look-alikes (0/O, 1/I/L), unique per report.
export function newReportRef(random: (n: number) => Buffer): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = random(8);
  return `BM-${[...bytes].map((b) => alphabet[b % alphabet.length]).join("")}`;
}
