import { promises as dns } from "node:dns";
import Fastify from "fastify";
import { chromium } from "playwright";
import { z } from "zod";
import { isScanAllowed } from "./robots";
import { isBlockedIp } from "./ssrfGuard";

const PORT = Number(process.env.PORT ?? 3100);
const NAV_TIMEOUT_MS = 15_000;

const ScanRequestSchema = z.object({
  url: z.string().url(),
  userAgent: z.string().min(1),
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

const app = Fastify({ logger: true });

app.post("/scan", async (request, reply) => {
  const parsed = ScanRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
  }
  const { url, userAgent } = parsed.data;
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

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    const redirectChain: string[] = [url];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && frame.url() !== redirectChain[redirectChain.length - 1]) {
        redirectChain.push(frame.url());
      }
    });

    await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });

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

    const screenshotBuffer = await page.screenshot({ fullPage: false }).catch(() => null);

    await context.close();

    return reply.send({
      skipped: false,
      finalUrl: page.url(),
      redirectChain,
      title,
      metaDescription,
      extractedText: (extractedText ?? "").slice(0, 5000),
      hasLoginForm: hasPasswordField,
      hasPaymentForm: hasPaymentKeyword || hasPaymentInput,
      looksParked,
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
