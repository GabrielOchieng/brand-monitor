import path from "node:path";
import fs from "node:fs/promises";
import { SCANNER_USER_AGENT } from "@brand-monitor/shared";
import { withTenant } from "../lib/tenant";
import { fetchFaviconHash } from "../lib/favicon";
import { scanWebsite } from "../lib/scannerClient";
import { computeRegionalHashes, serializeRegionalHashes } from "../lib/visualSimilarity";

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
