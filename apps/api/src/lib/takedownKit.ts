// The takedown kit: every reporting channel that applies to a finding, each with a
// ready-to-send message built from the evidence we already hold. Nothing here sends
// anything -- the analyst sends from their own mailbox/phone, because a report from a
// named person at the brand carries more weight than an automated one, and so that no
// report goes out without a human checking it first.
//
// Channels are hit in parallel on purpose: the registrar can suspend the domain, the host
// can remove the site, Safe Browsing puts a warning in front of visitors while both are
// pending, and Safaricom/WhatsApp cut the scam off from its victims and their money even
// if the site stays up. Which one actually works first is measured by the takedown
// tracker (each "mark as reported" creates a row whose requested/resolved times we keep).

export type KitChannelKind = "email" | "form" | "sms" | "app";

export interface KitChannel {
  key: string;
  // What "mark as reported" logs as the takedown row's provider, so the tracker can show
  // which channels have already been used.
  trackerLabel: string;
  title: string;
  kind: KitChannelKind;
  to: string | null;
  subject: string | null;
  body: string;
  // A form to open, or a mailto:/wa.me link. Null when the channel is copy-only.
  openUrl: string | null;
  instructions: string;
}

export interface KitInput {
  finding: { identifier: string; type: string; firstDetectedAt: Date };
  brand: { name: string; primaryDomain: string };
  domainIntel: {
    registrar: string | null;
    registeredAt: Date | null;
    ip: string | null;
    registrarAbuseEmail: string | null;
    hostingOrg: string | null;
    hostingAbuseEmail: string | null;
  } | null;
  websiteIntel: { title: string | null } | null;
  socialIntel: { platform: string; handle: string | null; postUrl: string | null; title: string | null; snippet: string | null } | null;
  // Reasons from the latest scan's positive score events, in order.
  reasons: string[];
  indicators: Array<{ kind: string; value: string }>;
  screenshotUrl: string | null;
}

export const KE_CIRT_EMAIL = "incidents@ke-cirt.go.ke";

const SIGN_OFF = (brand: string) => `[Your name]\n[Your role], on behalf of ${brand}`;

// Hosts that ask for abuse reports through a web form rather than email. Matched against
// the IP RDAP organisation name (domain_intel.hosting_org), e.g. "Vercel, Inc".
const HOST_FORMS: Array<{ match: RegExp; name: string; url: string; note: string }> = [
  {
    match: /vercel/i,
    name: "Vercel",
    url: "https://vercel.com/abuse",
    note: "Choose phishing/fraud, paste the URL and the message below. Keep the case number Vercel returns.",
  },
  {
    match: /cloudflare/i,
    name: "Cloudflare",
    url: "https://abuse.cloudflare.com/",
    note: "Choose the phishing form. Cloudflare usually sits in front of the real host and forwards the report to it; it also reveals the real host to you.",
  },
];

const KENYAN_MOBILE = /^\+254[17]\d{8}$/;

export function findingUrl(input: KitInput): string {
  const id = input.finding.identifier;
  return /^https?:\/\//i.test(id) ? id : `https://${id}`;
}

function formatDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "unknown";
}

function contactLines(indicators: KitInput["indicators"]): string[] {
  const labels: Record<string, string> = {
    phone: "Phone",
    whatsapp: "WhatsApp",
    mpesa_paybill: "M-Pesa paybill",
    mpesa_till: "M-Pesa till",
    email: "Email",
    telegram: "Telegram",
    crypto_wallet: "Crypto wallet",
  };
  return indicators.map((i) => `${labels[i.kind] ?? i.kind}: ${i.value}`);
}

// The evidence block every written report shares.
export function evidenceText(input: KitInput): string {
  const { brand, domainIntel: di, websiteIntel: wi, socialIntel: si } = input;
  const lines: string[] = [];
  if (si) {
    lines.push(`- Account: ${input.finding.identifier} (${si.platform}${si.handle ? `, @${si.handle}` : ""})`);
    if (si.postUrl && si.postUrl !== input.finding.identifier) lines.push(`- Post: ${si.postUrl}`);
    if (si.title) lines.push(`- Shown as: "${si.title.slice(0, 200)}"`);
  } else {
    lines.push(`- URL: ${findingUrl(input)}`);
    if (wi?.title) lines.push(`- Page title: "${wi.title.slice(0, 200)}"`);
  }
  lines.push(`- Official ${brand.name} website: https://${brand.primaryDomain}`);
  lines.push(`- First detected by our monitoring: ${formatDate(input.finding.firstDetectedAt)}`);
  if (di) {
    if (di.registeredAt || di.registrar) lines.push(`- Domain registered: ${formatDate(di.registeredAt)}${di.registrar ? ` via ${di.registrar}` : ""}`);
    if (di.ip) lines.push(`- IP address: ${di.ip}${di.hostingOrg ? ` (${di.hostingOrg})` : ""}`);
  }
  const contacts = contactLines(input.indicators);
  if (contacts.length > 0) {
    lines.push(`- Contact/payment details the scammers use:`);
    for (const c of contacts) lines.push(`    ${c}`);
  }
  if (input.reasons.length > 0) {
    lines.push(`- Why we believe it is fraudulent:`);
    for (const r of input.reasons) lines.push(`    ${r}`);
  }
  if (input.screenshotUrl) lines.push(`- Screenshot: ${input.screenshotUrl}`);
  return lines.join("\n");
}

function letter(input: KitInput, opening: string, ask: string): string {
  return `Hello,\n\n${opening}\n\nEvidence:\n${evidenceText(input)}\n\n${ask}\n\nThank you,\n${SIGN_OFF(input.brand.name)}`;
}

function mailto(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// mailto: links past ~2,000 characters get truncated or ignored by some mail clients;
// the copy buttons always carry the full text.
const MAILTO_MAX = 1900;

function emailChannel(c: Omit<KitChannel, "kind" | "openUrl"> & { to: string; subject: string }): KitChannel {
  const link = mailto(c.to, c.subject, c.body);
  return { ...c, kind: "email", openUrl: link.length <= MAILTO_MAX ? link : `mailto:${c.to}?subject=${encodeURIComponent(c.subject)}` };
}

export function buildTakedownKit(input: KitInput): KitChannel[] {
  const { brand, domainIntel: di, socialIntel: si } = input;
  const channels: KitChannel[] = [];
  const url = findingUrl(input);
  const target = si ? input.finding.identifier : input.finding.identifier.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const subject = `Fraud: ${target} is impersonating ${brand.name}`;

  if (si) {
    channels.push(socialChannel(input, subject));
  } else {
    // Registrar: only for a domain finding -- a URL finding usually sits on someone else's
    // domain (a free-hosting subdomain, a hacked site), where the registrar can't help.
    if (input.finding.type === "domain") {
      const ask = `Please suspend this domain (clientHold). It exists only to impersonate ${brand.name} and defraud its customers, which breaches your registration agreement and acceptable-use policy.`;
      const body = letter(input, `We are reporting the domain ${target}, which impersonates ${brand.name} to defraud ${brand.name}'s customers.`, ask);
      if (di?.registrarAbuseEmail) {
        channels.push(
          emailChannel({
            key: "registrar",
            trackerLabel: `${di.registrar ?? "Registrar"} (registrar)`,
            title: `Registrar${di.registrar ? `: ${di.registrar}` : ""}`,
            to: di.registrarAbuseEmail,
            subject,
            body,
            instructions: "Suspending the domain takes the site down wherever it is hosted. Ask for clientHold, not just content removal.",
          })
        );
      } else {
        channels.push({
          key: "registrar",
          trackerLabel: `${di?.registrar ?? "Registrar"} (registrar)`,
          title: `Registrar${di?.registrar ? `: ${di.registrar}` : ""}`,
          kind: "form",
          to: null,
          subject,
          body,
          openUrl: `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(target)}`,
          instructions: "No registrar abuse contact was found in the registry record. Open ICANN Lookup to find it, then send the message below.",
        });
      }
    }

    // Hosting provider.
    if (di?.hostingOrg) {
      const form = HOST_FORMS.find((h) => h.match.test(di.hostingOrg!));
      const ask = "Please remove this site and suspend the account behind it. The same operator may redeploy under a new name, so please also check the account for related projects.";
      const body = letter(input, `We are reporting ${url}, hosted on your network, which impersonates ${brand.name} to defraud its customers.`, ask);
      if (form) {
        channels.push({
          key: "hosting",
          trackerLabel: `${form.name} (hosting)`,
          title: `Hosting: ${form.name}`,
          kind: "form",
          to: null,
          subject,
          body,
          openUrl: form.url,
          instructions: form.note,
        });
      } else if (di.hostingAbuseEmail) {
        channels.push(
          emailChannel({
            key: "hosting",
            trackerLabel: `${di.hostingOrg} (hosting)`,
            title: `Hosting: ${di.hostingOrg}`,
            to: di.hostingAbuseEmail,
            subject,
            body,
            instructions: "The host can remove the site even while the domain stays registered.",
          })
        );
      }
    }

    // Browser warnings while the takedown is pending.
    channels.push({
      key: "safe_browsing",
      trackerLabel: "Google Safe Browsing",
      title: "Google Safe Browsing",
      kind: "form",
      to: null,
      subject: null,
      body: `This site impersonates ${brand.name} (official site: https://${brand.primaryDomain}) to defraud ${brand.name}'s customers.${contactLines(input.indicators).length ? ` Payment/contact details used: ${contactLines(input.indicators).join("; ")}.` : ""}`,
      openUrl: `https://safebrowsing.google.com/safebrowsing/report_phish/?url=${encodeURIComponent(url)}`,
      instructions: "Once listed, Chrome, Android, Firefox and Safari show visitors a red warning page. It doesn't remove the site, but it protects customers while the takedown is pending. Paste the text below into the details box.",
    });
  }

  // Phone/WhatsApp numbers: cutting these off stops the money even if the site stays up.
  const kenyanNumbers = [...new Set(input.indicators.filter((i) => (i.kind === "phone" || i.kind === "whatsapp") && KENYAN_MOBILE.test(i.value)).map((i) => i.value))];
  if (kenyanNumbers.length > 0) {
    channels.push({
      key: "safaricom_333",
      trackerLabel: "Safaricom 333",
      title: "Safaricom fraud line (333)",
      kind: "sms",
      to: "333",
      subject: null,
      body: `Fraud: ${kenyanNumbers.join(", ")} ${kenyanNumbers.length > 1 ? "are" : "is"} used by ${target}, a fake ${brand.name} ${si ? "account" : "website"}, to take money from customers.`,
      openUrl: null,
      instructions: "Send this as a free SMS to 333 from a Safaricom line; Safaricom blocks numbers reported for fraud. If a number is on another network, report it to that network as well.",
    });
  }
  const whatsappNumbers = [...new Set(input.indicators.filter((i) => i.kind === "whatsapp").map((i) => i.value))];
  for (const n of whatsappNumbers) {
    channels.push({
      key: `whatsapp_${n.replace(/\D/g, "")}`,
      trackerLabel: `WhatsApp ${n}`,
      title: `WhatsApp: ${n}`,
      kind: "app",
      to: n,
      subject: null,
      body: `${n} is used by ${target} to impersonate ${brand.name} and take bookings and payments from customers.`,
      openUrl: `https://wa.me/${n.replace(/\D/g, "")}`,
      instructions: "Open the chat, tap the contact name, then Report (and Block). Don't send any message first.",
    });
  }

  // National CERT: an official record, and it can escalate to providers.
  channels.push(
    emailChannel({
      key: "ke_cirt",
      trackerLabel: "KE-CIRT/CC",
      title: "KE-CIRT/CC (national CERT)",
      to: KE_CIRT_EMAIL,
      subject,
      body: letter(
        input,
        `We are reporting ${si ? "a social media account" : "a website"} impersonating ${brand.name} to defraud Kenyan customers, and request your assistance with its takedown.`,
        "We have also reported it to the providers involved. Please escalate as you see fit and let us know if you need anything further."
      ),
      instructions: "Kenya's national incident response team. Gives an official record and can escalate to providers.",
    })
  );

  return channels;
}

function socialChannel(input: KitInput, subject: string): KitChannel {
  const si = input.socialIntel!;
  const { brand } = input;
  const body = letter(
    input,
    `The account ${input.finding.identifier} is impersonating ${brand.name} to defraud its customers.`,
    `Please remove this account. It is not affiliated with ${brand.name}.`
  );
  const base = { key: "platform", subject, body, to: null };
  switch (si.platform) {
    case "facebook":
      return {
        ...base,
        trackerLabel: "Facebook (impersonation)",
        title: "Facebook impersonation report",
        kind: "form",
        openUrl: "https://www.facebook.com/help/contact/295309487309948",
        instructions: "Facebook's impostor report form. Choose that the account pretends to be a business you represent, paste the account URL and the text below. Brands with a registered trademark can also use Meta's Brand Rights Protection to report at scale.",
      };
    case "instagram":
      return {
        ...base,
        trackerLabel: "Instagram (impersonation)",
        title: "Instagram impersonation report",
        kind: "app",
        openUrl: input.finding.identifier,
        instructions: "Open the profile, tap ⋯ → Report → \"It's pretending to be someone else\" → a business. Brands with a registered trademark can also use Meta's Brand Rights Protection.",
      };
    case "tiktok":
      return {
        ...base,
        trackerLabel: "TikTok (impersonation)",
        title: "TikTok impersonation report",
        kind: "app",
        openUrl: input.finding.identifier,
        instructions: "Open the profile, tap Share → Report → Account → Pretending to be someone. Trademark owners can also file TikTok's trademark complaint form.",
      };
    default:
      return {
        ...base,
        trackerLabel: `${si.platform} (impersonation)`,
        title: `${si.platform[0].toUpperCase()}${si.platform.slice(1)} impersonation report`,
        kind: "app",
        openUrl: input.finding.identifier,
        instructions: "Open the account and use the platform's Report → impersonation option, then paste the text below where it asks for details.",
      };
  }
}
