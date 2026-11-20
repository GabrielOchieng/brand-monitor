import { promises as dns } from "node:dns";
import Fastify from "fastify";
import { chromium } from "playwright";
import { z } from "zod";
import { isScanAllowed } from "./robots";
import { extractScriptLinks, isFirstPartyScript } from "./scriptLinks";
import { isBlockedIp } from "./ssrfGuard";

const PORT = Number(process.env.PORT ?? 3100);
const NAV_TIMEOUT_MS = 15_000;

const ScanRequestSchema = z.object({
  url: z.string().url(),
  userAgent: z.string().min(1),
  // Extra settle time before the screenshot, on top of domcontentloaded -- for a
  // candidate/phishing-kit page 0 (the default) is fine, but a real production site
  // (lazy-loaded hero images, web fonts, a carousel) can still be visibly mid-render at
  // that exact moment. Used only when capturing a brand's own reference screenshot
  // (enrichmentShared.ts's ensureBrandScreenshotHash), since that capture gets cached and
  // reused indefinitely -- one unlucky candidate scan is just one recheck, but one
  // unlucky reference capture becomes a permanently-wrong baseline.
  settleMs: z.number().min(0).max(10_000).optional(),
});

const PAYMENT_KEYWORDS = ["card number", "cvv", "expiry", "payment", "m-pesa", "mpesa", "pay now"];
const PARKING_KEYWORDS = [
  "domain is for sale",
  "buy this domain",
  "this domain may be for sale",
  "parked free",
  "domain parking",
  // Hosting-platform "nothing deployed here yet" placeholders -- deliberately narrow,
  // distinctive phrases, not generic ones like bare "page not found"/"app not found"
  // (those appear on real, actively-harmful custom error sub-pages too, and a false
  // positive here doesn't just cost a scoring point -- it permanently suppresses the
  // "just went live" alert for the finding that needs it most).
  "isn't live yet",
  "no such app",
  "deployment not found",
  "app not deployed",
];

const BLOCKED_RESOURCE_TYPES = new Set(["font", "media"]);
const MAX_LINKS = 300;
// Caps for reading the site's own JavaScript (scriptLinks.ts). Bundles are read from the
// responses the page already downloaded -- nothing is fetched twice.
const MAX_SCRIPTS = 30;
const MAX_SCRIPT_BYTES = 3_000_000;
const MAX_TOTAL_SCRIPT_BYTES = 10_000_000;
const SCRIPT_READ_TIMEOUT_MS = 3_000;

const app = Fastify({ logger: true });

app.post("/scan", async (request, reply) => {
  const parsed = ScanRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
  }
  const { url, userAgent, settleMs } = parsed.data;
  const target = new URL(url);
  const origin = target.origin;

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return reply.send({ skipped: true, reason: "target_not_allowed" });
  }

  try {
    const lookups = await dns.lookup(target.hostname, { all: true });
    if (lookups.some((l) => isBlockedIp(l.address))) {
      return reply.send({ skipped: true, reason: "target_not_allowed" });
    }
  } catch {
    return reply.send({ skipped: true, reason: "dns_resolution_failed" });
  }

  const allowed = await isScanAllowed(origin, userAgent);
  if (!allowed) {
    return reply.send({ skipped: true, reason: "robots_disallowed" });
  }

  // --disable-dev-shm-usage: Docker's default /dev/shm is tiny (64MB) and Chromium uses
  // shared memory heavily -- a well-established, independent crash cause in containers
  // regardless of total RAM, not specific to any one deployment target.
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({ userAgent, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // Bandwidth, not speed: Render's free workspace gets 5 GB/month of outbound traffic
    // (see apps/api/src/queue/boss.ts), and fonts/video/audio are pure weight for what we
    // extract -- text, forms, and a viewport screenshot. Images are kept: the screenshot
    // feeds visual similarity (lib/visualSimilarity.ts), so it has to look like the page.
    await page.route("**/*", (route) =>
      BLOCKED_RESOURCE_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue()
    );

    const redirectChain: string[] = [url];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && frame.url() !== redirectChain[redirectChain.length - 1]) {
        redirectChain.push(frame.url());
      }
    });

    // The site's own script files, read as they arrive. A booking flow's WhatsApp link
    // often exists only in JS (scriptLinks.ts).
    const scriptBodies: Promise<string>[] = [];
    let scriptBytes = 0;
    page.on("response", (res) => {
      if (res.request().resourceType() !== "script" || scriptBodies.length >= MAX_SCRIPTS) return;
      if (!isFirstPartyScript(res.url(), [target.hostname, new URL(page.url() === "about:blank" ? url : page.url()).hostname])) return;
      const length = Number(res.headers()["content-length"] ?? 0);
      if (length > MAX_SCRIPT_BYTES) return;
      scriptBodies.push(
        res
          .text()
          .then((body) => {
            if (body.length > MAX_SCRIPT_BYTES || scriptBytes + body.length > MAX_TOTAL_SCRIPT_BYTES) return "";
            scriptBytes += body.length;
            return body;
          })
          .catch(() => "")
      );
    });

    const response = await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
    const httpStatus = response?.status() ?? null;
    if (settleMs) await page.waitForTimeout(settleMs);

    const title = await page.title().catch(() => null);
    const metaDescription = await page
      .locator('meta[name="description"]')
      .first()
      .getAttribute("content")
      .catch(() => null);
    const extractedText = await page
      .locator("body")
      .innerText({ timeout: 3000 })
      .catch(() => "");

    const hasPasswordField = await page.locator('input[type="password"]').count().then((c) => c > 0);
    const lowerText = (extractedText ?? "").toLowerCase();
    const hasPaymentKeyword = PAYMENT_KEYWORDS.some((k) => lowerText.includes(k));
    const hasPaymentInput = await page
      .locator('input[inputmode="numeric"], input[autocomplete*="cc-"]')
      .count()
      .then((c) => c > 0);

    // Fold the title in too, not just body text -- a hosting platform's "not deployed
    // yet" placeholder (e.g. Google Cloud Run/App Engine's default page) often carries
    // its only meaningful text in the title, with the body being pure decorative
    // logo/ASCII-art content that never matches any keyword and is long enough to dodge
    // the short-body fallback below. Confirmed directly against a real case where this
    // mattered: "This app isn't live yet" existed only in the title, never the body.
    const lowerTitleAndText = `${title ?? ""} ${extractedText ?? ""}`.toLowerCase();
    const looksParked = PARKING_KEYWORDS.some((k) => lowerTitleAndText.includes(k)) || lowerText.trim().length < 40;

    // For contact/payment extraction (apps/api/src/lib/indicators.ts): scam pages often
    // keep the number only in a wa.me / tel: button, never in visible text.
    const links = await page
      .$$eval(
        "a[href]",
        (as, max) => [...new Set(as.map((a) => a.getAttribute("href") ?? ""))].filter(Boolean).slice(0, max),
        MAX_LINKS
      )
      .catch(() => [] as string[]);

    const inlineScripts = await page
      .$eval("script:not([src])", (els) => els.map((e: { textContent: string | null }) => e.textContent ?? ""))
      .catch(() => [] as string[]);
    // A body still downloading when the shared timeout fires counts as empty; the rest are kept.
    const scriptTimeout = new Promise<string>((resolve) => setTimeout(() => resolve(""), SCRIPT_READ_TIMEOUT_MS));
    const externalScripts = await Promise.all(scriptBodies.map((body) => Promise.race([body, scriptTimeout])));
    const scriptLinks = extractScriptLinks([...inlineScripts, ...externalScripts]);

    const screenshotBuffer = await page.screenshot({ fullPage: false }).catch(() => null);

    await context.close();

    return reply.send({
      skipped: false,
      finalUrl: page.url(),
      redirectChain,
      title,
      metaDescription,
      extractedText: (extractedText ?? "").slice(0, 5000),
      // The stored excerpt above is cut at 5000 chars; contact details usually sit in the
      // footer, past that. The scanner and API share a container, so the extra text costs
      // no outbound bandwidth.
      indicatorText: (extractedText ?? "").slice(0, 50000),
      links,
      // Contact links found only inside the site's own JavaScript (scriptLinks.ts).
      scriptLinks,
      hasLoginForm: hasPasswordField,
      hasPaymentForm: hasPaymentKeyword || hasPaymentInput,
      looksParked,
      httpStatus,
      screenshotBase64: screenshotBuffer ? screenshotBuffer.toString("base64") : null,
    });
  } catch (err: any) {
    return reply.send({ skipped: true, reason: "scan_failed", error: String(err?.message ?? err) });
  } finally {
    await browser.close();
  }
});

app.get("/health", async () => ({ ok: true }));

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  app.log.info(`scanner listening on ${PORT}`);
});
