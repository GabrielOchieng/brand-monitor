import { createSign } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { z } from "zod";
import { env } from "../env";

// Sends mail from an organization's OWN mailbox (automatic takedown reporting): Microsoft 365
// through Graph, Google Workspace through the Gmail API, or the org's SMTP server. Mail claiming
// to be from the org's domain must leave through the org's own mail system, or SPF/DKIM/DMARC
// fail and abuse desks drop it -- so there is deliberately no "send as them via our SMTP" option.

const email = z.string().trim().toLowerCase().email().max(254);

export const GraphConfigSchema = z.object({
  provider: z.literal("graph"),
  // Directory (tenant) ID: a GUID or the tenant's domain.
  tenantId: z.string().trim().regex(/^[A-Za-z0-9.-]{3,100}$/),
  clientId: z.string().trim().regex(/^[0-9a-fA-F-]{36}$/),
  clientSecret: z.string().min(1).max(500),
});
export const GmailConfigSchema = z.object({
  provider: z.literal("gmail"),
  // The service account's JSON key file, as downloaded from Google Cloud.
  serviceAccountKey: z.string().min(1).max(10_000),
});
export const SmtpConfigSchema = z.object({
  provider: z.literal("smtp"),
  host: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]{1,253}$/),
  port: z.union([z.literal(25), z.literal(465), z.literal(587), z.literal(2525)]),
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(500),
});
export const SenderSecretsSchema = z.discriminatedUnion("provider", [GraphConfigSchema, GmailConfigSchema, SmtpConfigSchema]);
export type SenderSecrets = z.infer<typeof SenderSecretsSchema>;

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export function parseServiceAccountKey(raw: string): ServiceAccountKey | null {
  try {
    const k = JSON.parse(raw);
    if (typeof k?.client_email !== "string" || typeof k?.private_key !== "string") return null;
    if (!k.private_key.includes("PRIVATE KEY")) return null;
    return { client_email: k.client_email, private_key: k.private_key };
  } catch {
    return null;
  }
}

// What may be shown back to the org (never the secrets).
export function publicConfigOf(s: SenderSecrets): Record<string, string | number> {
  switch (s.provider) {
    case "graph":
      return { tenantId: s.tenantId, clientId: s.clientId };
    case "gmail":
      return { serviceAccount: parseServiceAccountKey(s.serviceAccountKey)?.client_email ?? "" };
    case "smtp":
      return { host: s.host, port: s.port, username: s.username };
  }
}

export interface SenderIdentity {
  fromAddress: string;
  fromName: string | null;
  replyTo: string | null;
  bccArchive: string | null;
}

export interface OrgMailMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  attachments?: Array<{ filename: string; contentType: string; content: Buffer }>;
}

export class MailSendError extends Error {}

const TIMEOUT_MS = 20_000;

function recipients(identity: SenderIdentity, m: OrgMailMessage) {
  const bcc = [...(m.bcc ?? []), ...(identity.bccArchive ? [identity.bccArchive] : [])];
  return { to: m.to, cc: m.cc ?? [], bcc };
}

export async function sendOrgMail(secrets: SenderSecrets, identity: SenderIdentity, m: OrgMailMessage): Promise<{ messageId: string | null }> {
  for (const a of [...m.to, ...(m.cc ?? []), ...(m.bcc ?? [])]) {
    if (!email.safeParse(a).success) throw new MailSendError(`invalid recipient: ${a}`);
  }
  if (m.to.length === 0) throw new MailSendError("no recipient");
  switch (secrets.provider) {
    case "graph":
      return sendViaGraph(secrets, identity, m);
    case "gmail":
      return sendViaGmail(secrets, identity, m);
    case "smtp":
      return sendViaSmtp(secrets, identity, m);
  }
}

// --- Microsoft 365 (Graph, app-only) ----------------------------------------------------
// The org's IT registers an app with the Mail.Send application permission and scopes it to the
// one mailbox with RBAC for Applications (Microsoft's replacement for Application Access Policies).

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try {
    const j = JSON.parse(body);
    const msg = j?.error?.message ?? j?.error_description ?? j?.error ?? body;
    return `${res.status} ${String(typeof msg === "string" ? msg : JSON.stringify(msg))}`.slice(0, 300);
  } catch {
    return `${res.status} ${body}`.slice(0, 300);
  }
}

export function graphMessage(identity: SenderIdentity, m: OrgMailMessage) {
  const r = recipients(identity, m);
  const addr = (a: string) => ({ emailAddress: { address: a } });
  return {
    message: {
      subject: m.subject,
      body: { contentType: "Text", content: m.text },
      toRecipients: r.to.map(addr),
      ccRecipients: r.cc.map(addr),
      bccRecipients: r.bcc.map(addr),
      ...(identity.replyTo ? { replyTo: [addr(identity.replyTo)] } : {}),
      ...(m.attachments?.length
        ? {
            attachments: m.attachments.map((a) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: a.filename,
              contentType: a.contentType,
              contentBytes: a.content.toString("base64"),
            })),
          }
        : {}),
    },
    saveToSentItems: true,
  };
}

async function sendViaGraph(s: z.infer<typeof GraphConfigSchema>, identity: SenderIdentity, m: OrgMailMessage) {
  const tokenRes = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(s.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: s.clientId,
      client_secret: s.clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tokenRes.ok) throw new MailSendError(`Microsoft sign-in failed: ${await readError(tokenRes)}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(identity.fromAddress)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(graphMessage(identity, m)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 202 Accepted, no body and no message id.
  if (res.status !== 202) throw new MailSendError(`Microsoft Graph refused the message: ${await readError(res)}`);
  return { messageId: null };
}

// --- Google Workspace (Gmail API, service account with domain-wide delegation) ----------
// The org's admin grants the service account the gmail.send scope; it then acts as the sender
// mailbox (the JWT's `sub`). Sends count against that user's ~2,000/day Gmail limit.

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function gmailAssertion(key: ServiceAccountKey, subject: string, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      sub: subject,
      scope: "https://www.googleapis.com/auth/gmail.send",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(key.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

function fromHeader(identity: SenderIdentity) {
  return identity.fromName ? { name: identity.fromName, address: identity.fromAddress } : identity.fromAddress;
}

export async function buildMime(identity: SenderIdentity, m: OrgMailMessage): Promise<Buffer> {
  const r = recipients(identity, m);
  const node = new MailComposer({
    from: fromHeader(identity),
    to: r.to,
    cc: r.cc,
    bcc: r.bcc,
    replyTo: identity.replyTo ?? undefined,
    subject: m.subject,
    text: m.text,
    attachments: m.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
  }).compile();
  // The Gmail API reads recipients from the headers, so Bcc must stay in (it delivers to them
  // and strips the header). MailComposer drops it by default.
  (node as any).keepBcc = true;
  return node.build();
}

async function sendViaGmail(s: z.infer<typeof GmailConfigSchema>, identity: SenderIdentity, m: OrgMailMessage) {
  const key = parseServiceAccountKey(s.serviceAccountKey);
  if (!key) throw new MailSendError("The service account key isn't a valid Google JSON key file");
  let assertion: string;
  try {
    assertion = gmailAssertion(key, identity.fromAddress);
  } catch {
    throw new MailSendError("The service account's private key couldn't be read");
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tokenRes.ok) throw new MailSendError(`Google sign-in failed: ${await readError(tokenRes)}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const raw = (await buildMime(identity, m)).toString("base64url");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new MailSendError(`Gmail refused the message: ${await readError(res)}`);
  const { id } = (await res.json()) as { id?: string };
  return { messageId: id ?? null };
}

// --- SMTP (the org's own server) ---------------------------------------------------------
// The API connects from inside the VPS, so the host must resolve to a public address (else an
// org could point it at internal services). We connect to the address we checked, not the name,
// so the name can't be re-pointed between the check and the connection; TLS still verifies the name.

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a >= 224) return false; // multicast, reserved
    return true;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return false;
    if (v.startsWith("fc") || v.startsWith("fd")) return false; // unique local
    if (/^fe[89ab]/.test(v)) return false; // link-local
    if (v.startsWith("::ffff:")) return isPublicAddress(v.slice(7));
    return true;
  }
  return false;
}

async function resolveSmtpHost(host: string): Promise<string> {
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new MailSendError(`The SMTP host ${host} doesn't resolve`);
  }
  if (addresses.length === 0) throw new MailSendError(`The SMTP host ${host} doesn't resolve`);
  if (!env.takedownSmtpAllowPrivate && addresses.some((a) => !isPublicAddress(a.address))) {
    throw new MailSendError("The SMTP host must be a public address");
  }
  return addresses[0].address;
}

async function sendViaSmtp(s: z.infer<typeof SmtpConfigSchema>, identity: SenderIdentity, m: OrgMailMessage) {
  const address = await resolveSmtpHost(s.host);
  const r = recipients(identity, m);
  const transport = nodemailer.createTransport({
    host: address,
    port: s.port,
    secure: s.port === 465,
    // Never send credentials in the clear: STARTTLS is required on the other ports.
    requireTLS: s.port !== 465,
    tls: { servername: s.host },
    auth: { user: s.username, pass: s.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  try {
    const info = await transport.sendMail({
      from: fromHeader(identity),
      to: r.to,
      cc: r.cc,
      bcc: r.bcc,
      replyTo: identity.replyTo ?? undefined,
      subject: m.subject,
      text: m.text,
      attachments: m.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
    });
    return { messageId: info.messageId ?? null };
  } catch (err: any) {
    throw new MailSendError(`The SMTP server refused the message: ${String(err?.message ?? err).slice(0, 250)}`);
  } finally {
    transport.close();
  }
}

// --- DNS checks shown during setup ---------------------------------------------------------

export interface SenderDnsCheck {
  domain: string;
  spf: string | null;
  dmarc: string | null;
  dmarcPolicy: string | null;
}

export async function checkSenderDns(fromAddress: string): Promise<SenderDnsCheck> {
  const { resolveTxt } = await import("node:dns/promises");
  const domain = fromAddress.split("@")[1]?.toLowerCase() ?? "";
  const txt = async (name: string) => {
    try {
      return (await resolveTxt(name)).map((parts) => parts.join(""));
    } catch {
      return [];
    }
  };
  const [root, dmarcRecords] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`)]);
  const spf = root.find((r) => r.toLowerCase().startsWith("v=spf1")) ?? null;
  const dmarc = dmarcRecords.find((r) => r.toLowerCase().startsWith("v=dmarc1")) ?? null;
  const dmarcPolicy = dmarc?.match(/;\s*p=([a-z]+)/i)?.[1]?.toLowerCase() ?? null;
  return { domain, spf, dmarc, dmarcPolicy };
}
