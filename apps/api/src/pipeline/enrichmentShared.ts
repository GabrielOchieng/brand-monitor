import path from "node:path";
import fs from "node:fs/promises";
import { SCANNER_USER_AGENT } from "@brand-monitor/shared";
import { withTenant } from "../lib/tenant";
import { fetchFaviconHash } from "../lib/favicon";
import { scanWebsite } from "../lib/scannerClient";
import { computeRegionalHashes, serializeRegionalHashes } from "../lib/visualSimilarity";
import {
  extractIndicators,
  serializeIndicators,
  deserializeIndicatorKeys,
  indicatorKey,
  INDICATOR_LABELS,
  type Indicator,
  type IndicatorKind,
} from "../lib/indicators";

const SCREENSHOT_DIR = path.join(process.cwd(), "screenshots");

// A cached BrandAsset used to be kept forever -- fine for a favicon, which rarely
// changes, but wrong once a *screenshot* reference is cached the same way: a brand
// redesigning their real site would otherwise silently and permanently freeze this
// feature's baseline against the old design, with nothing telling anyone. TTL-based
// lazy refresh instead of cache-forever, applied to both asset types for consistency.
const BRAND_ASSET_TTL_MS = 45 * 24 * 60 * 60 * 1000; // 45 days

function isExpired(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > BRAND_ASSET_TTL_MS;
}

// Confirmed for real, not hypothetical: a brand's own real site can sit behind
// bot-protection (Imperva, Cloudflare, etc.) that serves a CAPTCHA/challenge page to a
// generic headless browser instead of the real homepage -- a plain, generic "BrandMonitorBot"
// user-agent has no special standing with these services just because it's scanning the
// site's own owner's brand. If that challenge page got cached as the reference, every
// future candidate comparison would silently run against a CAPTCHA page instead of the
// real site. Narrow, curated keyword list, same idiom as the scanner's own looksParked
// check -- this doesn't try to evade bot-detection, it just refuses to trust a capture
// that's obviously not the real page.
const BOT_CHALLENGE_KEYWORDS = [
  "hcaptcha",
  "recaptcha",
  "are you human",
  "security check is required",
  "checking your browser",
  "just a moment", // Cloudflare's interstitial title
  "attention required", // Cloudflare's block-page title
  "protected by imperva",
  "please verify you are a human",
];

function looksLikeBotChallenge(title: string | null | undefined, text: string | null | undefined): boolean {
  const combined = `${title ?? ""} ${text ?? ""}`.toLowerCase();
  return BOT_CHALLENGE_KEYWORDS.some((k) => combined.includes(k));
}

export async function ensureBrandFaviconHash(orgId: string, brandId: string, primaryDomain: string): Promise<string | null> {
  const existing = await withTenant(orgId, (tx) =>
    tx.brandAsset.findFirst({ where: { brandId, type: "favicon" }, orderBy: { createdAt: "desc" } })
  );
  if (existing && !isExpired(existing.createdAt)) return existing.hash;

  const hash = await fetchFaviconHash(primaryDomain, SCANNER_USER_AGENT);
  if (!hash) return existing?.hash ?? null; // fetch failed -- fall back to a stale-but-real hash rather than nothing

  await withTenant(orgId, (tx) =>
    tx.brandAsset.create({
      data: { brandId, type: "favicon", sourceUrl: `https://${primaryDomain}/favicon.ico`, hash },
    })
  );
  return hash;
}

// Mirrors ensureBrandFaviconHash exactly, for the brand's own real homepage instead of
// its favicon. This is the first time this pipeline ever scans a brand's OWN domain --
// every other call to scanWebsite() today targets a candidate/lookalike. A longer
// settleMs than a normal candidate scan is deliberate: a real production site (lazy
// images, web fonts, a hero carousel) can still be visibly mid-render at the exact
// moment a fast candidate-tuned screenshot fires, and since this capture is cached and
// reused indefinitely (until the TTL above), one unlucky capture would otherwise become
// a permanently-wrong baseline. The reference screenshot is also saved to disk (served
// via the existing /screenshots/ static route) so it's inspectable by a human if a
// brand's visual-similarity matches look wrong -- not a dedicated review UI, just a
// visible file. A failed/skipped capture (robots-disallow, bot-detection challenge page,
// a redesign mid-flight) just means this feature stays inactive for that brand, same as
// any other "skipped" scan elsewhere in this pipeline -- logged, not alerted on.
export async function ensureBrandScreenshotHash(orgId: string, brandId: string, primaryDomain: string): Promise<string | null> {
  const existing = await withTenant(orgId, (tx) =>
    tx.brandAsset.findFirst({ where: { brandId, type: "screenshot" }, orderBy: { createdAt: "desc" } })
  );
  if (existing && !isExpired(existing.createdAt)) return existing.hash;

  const result = await scanWebsite(`https://${primaryDomain}`, SCANNER_USER_AGENT, 2000);
  if (result.skipped || !result.screenshotBase64) {
    console.warn(`[visual-similarity] couldn't capture a reference screenshot for brand ${brandId} (${primaryDomain}): ${result.reason ?? "no screenshot returned"}`);
    return existing?.hash ?? null;
  }
  if (looksLikeBotChallenge(result.title, result.extractedText)) {
    console.warn(`[visual-similarity] reference capture for brand ${brandId} (${primaryDomain}) looks like a bot-detection challenge page (title: "${result.title}"), not the real site -- refusing to cache it as the baseline.`);
    return existing?.hash ?? null;
  }

  const buffer = Buffer.from(result.screenshotBase64, "base64");
  const hashes = await computeRegionalHashes(buffer);
  if (!hashes) return existing?.hash ?? null;

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await fs.writeFile(path.join(SCREENSHOT_DIR, `brand-${brandId}.png`), buffer);

  const serialized = serializeRegionalHashes(hashes);
  await withTenant(orgId, (tx) =>
    tx.brandAsset.create({
      data: { brandId, type: "screenshot", sourceUrl: `https://${primaryDomain}`, hash: serialized },
    })
  );
  return serialized;
}

export async function saveScreenshot(findingId: string, base64: string): Promise<string> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filename = `${findingId}.png`;
  await fs.writeFile(path.join(SCREENSHOT_DIR, filename), Buffer.from(base64, "base64"));
  return `/screenshots/${filename}`;
}

// The brand's own published contacts (customer-care number, WhatsApp, emails), taken from
// its real homepage, so pages that quote them -- a legitimate travel agent, or a clone that
// left the real footer in -- don't get linked or scored on them (lib/indicators.ts).
// Stored as a BrandAsset like the favicon/screenshot references, "|"-joined in `hash`.
// A failed capture isn't stored (an empty list would hide the brand's numbers for 45
// days), but it is remembered in memory for a few hours: otherwise every recheck would
// rescan the brand's homepage, ~1.5 MB of Render bandwidth each time.
const OWN_INDICATOR_RETRY_MS = 6 * 60 * 60 * 1000;
const ownIndicatorFailedAt = new Map<string, number>();

export async function ensureBrandOwnIndicators(orgId: string, brandId: string, primaryDomain: string): Promise<Set<string>> {
  const existing = await withTenant(orgId, (tx) =>
    tx.brandAsset.findFirst({ where: { brandId, type: "contact_indicators" }, orderBy: { createdAt: "desc" } })
  );
  if (existing && !isExpired(existing.createdAt)) return deserializeIndicatorKeys(existing.hash);
  const failedAt = ownIndicatorFailedAt.get(brandId);
  if (failedAt && Date.now() - failedAt < OWN_INDICATOR_RETRY_MS) return deserializeIndicatorKeys(existing?.hash);

  const result = await scanWebsite(`https://${primaryDomain}`, SCANNER_USER_AGENT, 2000);
  // A blank page is a failed capture too: jambojet.com answers the scanner with HTTP 200
  // and an empty body (2026-10-19), which would otherwise be cached as "no contacts".
  const text = result.indicatorText ?? result.extractedText ?? "";
  if (result.skipped || text.trim().length < 200 || looksLikeBotChallenge(result.title, text)) {
    console.warn(`[indicators] couldn't read brand ${brandId}'s own contacts from ${primaryDomain}: ${result.reason ?? "blank page or bot challenge"}`);
    ownIndicatorFailedAt.set(brandId, Date.now());
    return deserializeIndicatorKeys(existing?.hash);
  }

  const serialized = serializeIndicators(extractIndicators(text, result.links ?? []));
  await withTenant(orgId, (tx) =>
    tx.brandAsset.create({ data: { brandId, type: "contact_indicators", sourceUrl: `https://${primaryDomain}`, hash: serialized } })
  );
  return deserializeIndicatorKeys(serialized);
}

// Which of this page's indicators appears on the most OTHER findings of the same brand.
// False positives are left out: an analyst already said that page isn't a threat, so
// sharing a number with it proves nothing.
export async function findMostSharedIndicator(
  organizationId: string,
  brandId: string,
  findingId: string,
  indicators: Indicator[]
): Promise<{ label: string; value: string; otherFindings: number } | null> {
  const rows = await withTenant(organizationId, (tx) =>
    tx.findingIndicator.findMany({
      where: {
        brandId,
        findingId: { not: findingId },
        finding: { status: { not: "false_positive" } },
        OR: indicators.map((i) => ({ kind: i.kind, value: i.value })),
      },
      select: { kind: true, value: true, findingId: true },
    })
  );
  const findingsByKey = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = indicatorKey({ kind: r.kind as IndicatorKind, value: r.value });
    findingsByKey.set(key, (findingsByKey.get(key) ?? new Set()).add(r.findingId));
  }
  // On a tie, the more scam-specific detail names the rule: a WhatsApp number or paybill
  // says more about who's behind a page than a shared email.
  const byPriority = [...indicators].sort((a, b) => SHARED_PRIORITY.indexOf(a.kind) - SHARED_PRIORITY.indexOf(b.kind));
  let best: { label: string; value: string; otherFindings: number } | null = null;
  for (const i of byPriority) {
    const count = findingsByKey.get(indicatorKey(i))?.size ?? 0;
    if (count > (best?.otherFindings ?? 0)) best = { label: INDICATOR_LABELS[i.kind], value: i.value, otherFindings: count };
  }
  return best;
}

const SHARED_PRIORITY: IndicatorKind[] = ["whatsapp", "mpesa_paybill", "mpesa_till", "crypto_wallet", "telegram", "phone", "email"];
