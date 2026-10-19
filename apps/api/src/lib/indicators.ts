// Contact and payment details pulled out of a scanned page: where the scam sends victims.
// Two uses: a value shared by two findings is the strongest sign they're one operation
// (far stronger than a shared registrar), and the values themselves are reportable --
// a phone number to Safaricom, a wallet to an exchange, a handle to Telegram.
//
// Deliberately biased against false positives: bare digit runs are never phone numbers
// (flight numbers, prices, booking refs, dates), only +-prefixed, 254-prefixed, or
// Kenyan 07xx/01xx numbers, tel:/WhatsApp links, or digits right after "Paybill"/"Till".
// M-Pesa detection is always on -- the live brand is Kenyan; make it per-brand-country
// if a non-Kenyan tenant ever shows up.

export const INDICATOR_KINDS = ["phone", "whatsapp", "mpesa_paybill", "mpesa_till", "email", "telegram", "crypto_wallet"] as const;
export type IndicatorKind = (typeof INDICATOR_KINDS)[number];

export interface Indicator {
  kind: IndicatorKind;
  value: string;
}

export const INDICATOR_LABELS: Record<IndicatorKind, string> = {
  phone: "phone number",
  whatsapp: "WhatsApp number",
  mpesa_paybill: "M-Pesa paybill",
  mpesa_till: "M-Pesa till",
  email: "email",
  telegram: "Telegram",
  crypto_wallet: "crypto wallet",
};

export const PAYMENT_INDICATOR_KINDS: ReadonlySet<IndicatorKind> = new Set(["mpesa_paybill", "mpesa_till", "crypto_wallet"]);

export function indicatorKey(i: Indicator): string {
  return `${i.kind}:${i.value}`;
}

// Kenyan mobile numbers are 07xx/01xx locally, +254 7xx/1xx internationally.
function normalizePhone(raw: string): string | null {
  const hasPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`;
  // No country code starts with 0.
  if (hasPlus && !digits.startsWith("0") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

// A tel: link is a phone number by definition, even in a foreign local format we can't
// put into E.164 (seen on jamboojet.com: tel:02191035700, Tehran). Kept as bare digits --
// still matches the same number on another page.
function normalizeTel(raw: string): string | null {
  const e164 = normalizePhone(raw);
  if (e164) return e164;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15 ? digits : null;
}

// WhatsApp links carry the number without a plus, in international format.
function normalizeWhatsappNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (!digits.startsWith("0") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

const IGNORED_EMAIL_DOMAINS = new Set(["example.com", "example.org", "example.net", "domain.com", "email.com", "yourdomain.com", "sentry.io"]);
const IMAGE_SUFFIX = /\.(png|jpe?g|gif|svg|webp|ico)$/i; // "logo@2x.png" is not an email

function normalizeEmail(raw: string): string | null {
  const email = raw.toLowerCase().replace(/\.+$/, "");
  if (IMAGE_SUFFIX.test(email)) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain || IGNORED_EMAIL_DOMAINS.has(domain)) return null;
  if (/^(no-?reply|you|your-?email|name|user)$/.test(local)) return null;
  return email;
}

const TELEGRAM_NON_HANDLES = new Set(["share", "s", "iv", "addstickers", "proxy", "socks"]);

// Base58 and TRON addresses are just long alphanumeric runs; requiring mixed case plus
// a digit keeps ordinary words and IDs out.
function looksRandom(s: string): boolean {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);
}

export function extractIndicators(text: string, links: string[] = []): Indicator[] {
  const found = new Map<string, Indicator>();
  const add = (kind: IndicatorKind, value: string | null) => {
    if (value) found.set(`${kind}:${value}`, { kind, value });
  };

  for (const link of links) {
    const lower = link.toLowerCase();
    if (lower.startsWith("tel:")) {
      add("phone", normalizeTel(decodeURIComponent(link.slice(4))));
    } else if (lower.startsWith("mailto:")) {
      add("email", normalizeEmail(decodeURIComponent(link.slice(7).split("?")[0])));
    } else {
      scanForLinkIndicators(link, add);
    }
  }
  // Links shown as plain text ("chat with us: wa.me/2547...") count too.
  scanForLinkIndicators(text, add);

  // The lookbehind keeps numbers embedded in URLs (wa.me/2547..., ?phone=2547...) out --
  // those are already counted as WhatsApp above.
  for (const m of text.matchAll(/(?<![\w+/=])(?:\+\s?\d[\d\s().-]{6,18}\d|254[\s-]?[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}|0[17]\d{2}[\s-]?\d{3}[\s-]?\d{3})(?![\d])/g)) {
    add("phone", normalizePhone(m[0]));
  }

  // "Paybill 247247", "Pay Bill No: 400200", "Business No. 522522", "Till Number 5123456".
  for (const m of text.matchAll(/\b(?:pay\s?bill|business)\s*(?:no|number|#)?\.?\s*[:\-]?\s*(\d{5,7})\b/gi)) add("mpesa_paybill", m[1]);
  for (const m of text.matchAll(/\b(?:buy\s+goods\s+)?till\s*(?:no|number|#)?\.?\s*[:\-]?\s*(\d{5,8})\b/gi)) add("mpesa_till", m[1]);

  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) add("email", normalizeEmail(m[0]));

  for (const m of text.matchAll(/\b0x[a-fA-F0-9]{40}\b/g)) add("crypto_wallet", m[0].toLowerCase());
  for (const m of text.matchAll(/\bbc1[ac-hj-np-z02-9]{25,87}\b/gi)) add("crypto_wallet", m[0].toLowerCase());
  for (const m of text.matchAll(/\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g)) if (looksRandom(m[0])) add("crypto_wallet", m[0]);
  for (const m of text.matchAll(/\bT[a-km-zA-HJ-NP-Z1-9]{33}\b/g)) if (looksRandom(m[0])) add("crypto_wallet", m[0]);

  return [...found.values()];
}

function scanForLinkIndicators(s: string, add: (kind: IndicatorKind, value: string | null) => void): void {
  for (const m of s.matchAll(/wa\.me\/\+?(\d{8,15})/gi)) add("whatsapp", normalizeWhatsappNumber(m[1]));
  for (const m of s.matchAll(/(?:api\.whatsapp\.com\/send|whatsapp:\/\/send)\/?\?(?:[^"'\s]*&)?phone=\+?(\d{8,15})/gi)) {
    add("whatsapp", normalizeWhatsappNumber(m[1]));
  }
  for (const m of s.matchAll(/\b(?:t|telegram)\.me\/(\+?[A-Za-z0-9_]{4,64})/gi)) {
    const handle = m[1].toLowerCase();
    if (!TELEGRAM_NON_HANDLES.has(handle)) add("telegram", handle);
  }
}

// Indicators from the brand's own site, plus any email at one of its own domains, are
// the real company's contacts: a legitimate travel agent quoting Jambojet's call centre
// must not link to a scam page that copied the same number.
export function withoutOwnIndicators(indicators: Indicator[], ownKeys: ReadonlySet<string>, ownDomains: string[]): Indicator[] {
  return indicators.filter((i) => {
    if (ownKeys.has(indicatorKey(i))) return false;
    if (i.kind === "email") {
      const domain = i.value.split("@")[1];
      if (ownDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) return false;
    }
    return true;
  });
}

// Stored in BrandAsset.hash (type "contact_indicators") as "kind:value|kind:value".
export function serializeIndicators(indicators: Indicator[]): string {
  return indicators.map(indicatorKey).join("|");
}

export function deserializeIndicatorKeys(serialized: string | null | undefined): Set<string> {
  return new Set((serialized ?? "").split("|").filter(Boolean));
}
