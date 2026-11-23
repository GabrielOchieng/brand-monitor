import { setDefaultResultOrder } from "node:dns";

// Explicit, first thing in the module graph: unlike Prisma's CLI (`prisma migrate`/`db
// seed`), which auto-loads .env itself, and unlike @prisma/client (which loads it as a
// side effect of instantiating PrismaClient), plain `tsx watch src/server.ts` does not
// load .env at all. Without this, non-Prisma env vars (SMTP_PASS etc.) silently
// read as empty strings whenever this module happened to evaluate before any
// PrismaClient was constructed elsewhere in the import graph. Node 20.6+ ships this natively; try/catch only because it's a
// no-op (not an error) if .env doesn't exist, e.g. in prod where real env vars are set.
try {
  // process.cwd() is apps/api when run the normal way (`npm run dev`, an npm workspace
  // script) -- matches the same assumption runPipeline.ts already makes for screenshots/.
  process.loadEnvFile(); // defaults to ./.env relative to cwd
} catch {
  // .env not present -- fine in environments where vars are injected another way.
}

// Confirmed real (not theoretical) via the old crt.sh integration: on a network with
// broken/unreliable IPv6 routing but IPv6 DNS records still present (this dev machine's
// VPN, and plausibly others), Node's fetch tries the AAAA address first and hangs for a
// 10s connect timeout before ever trying the working IPv4 address -- `curl` succeeded
// instantly against the exact same host because it doesn't have this bias. Forcing
// IPv4-first doesn't disable IPv6 (a genuinely IPv6-only host still resolves fine, just
// after IPv4 fails) -- it only fixes the "IPv6 route exists but is slow/dead" case, which
// is common enough on corporate/VPN networks that this is worth setting unconditionally
// rather than only patching the one call site that happened to surface it.
setDefaultResultOrder("ipv4first");

export const env = {
  port: Number(process.env.PORT ?? 4000),
  // 127.0.0.1, not localhost -- see .env.example: the same IPv6/::1 port-publish issue
  // already found and fixed for DATABASE_URL applies here too.
  scannerUrl: process.env.SCANNER_URL ?? "http://127.0.0.1:3100",
  // The running server always connects as the restricted brandmonitor_app role, never
  // the migration role in DATABASE_URL -- see apps/api/.env.example.
  databaseAppUrl: process.env.DATABASE_APP_URL ?? "",
  // Privileged (bypasses RLS) -- used ONLY by src/adminDb.ts; see that file for the narrow
  // list of callers.
  // Never use this for request-handling routes/pipeline code.
  databaseUrl: process.env.DATABASE_URL ?? "",
  smtpHost: process.env.SMTP_HOST ?? "smtp.gmail.com",
  smtpPort: Number(process.env.SMTP_PORT ?? 465),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
  // The web app's exact origin: links in emails, CORS, and the Origin check on every
  // state-changing request (server.ts). No trailing slash.
  webAppUrl: (process.env.WEB_APP_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  // Domain attribute of the session cookie, e.g. ".gabrielochieng.com" so the web app's
  // middleware on brand-monitor.gabrielochieng.com sees the cookie the API set. Empty = host-only
  // (local dev: localhost cookies are shared across ports).
  cookieDomain: process.env.COOKIE_DOMAIN ?? "",
  // 32 random bytes, base64 (`node -e "console.log(crypto.randomBytes(32).toString('base64'))"`).
  // Encrypts 2FA secrets (auth/secretBox.ts). Empty = 2FA can't be turned on. Changing it breaks
  // every enabled 2FA (users then need `npm run auth:disable-2fa`), so set it once and keep it.
  authEncryptionKey: process.env.AUTH_ENCRYPTION_KEY ?? "",
  // Sign in with Google (auth/google.ts): an OAuth client from Google Cloud Console (APIs &
  // Services -> Credentials, type "Web application"). Both empty = the button isn't shown.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  // The API's own public origin, for the Google redirect URI (<this>/auth/google/callback),
  // which must be registered on the OAuth client exactly. No trailing slash.
  apiPublicUrl: (process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/+$/, ""),
  // Tests only: point the code exchange at a fake token endpoint. Never set in production.
  googleTokenUrlOverride: process.env.GOOGLE_TOKEN_URL_OVERRIDE ?? "",
  // Local testing: "1" starts the API without queue workers or cron dispatchers, so nothing
  // scans or sends alert emails.
  disableSchedulers: process.env.DISABLE_SCHEDULERS === "1",
  // AI explanations (lib/aiExplain.ts) via any OpenAI-compatible Chat Completions API.
  // Default is Google Gemini's free tier (key from aistudio.google.com, no card). A
  // narration task fed pre-computed evidence -- a small "flash" model is enough.
  aiBaseUrl: process.env.AI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai",
  aiApiKey: process.env.AI_API_KEY ?? "",
  // Comma-separated fallback chain, tried in order (lib/aiExplain.ts).
  aiModels: (process.env.AI_MODEL ?? "gemini-2.5-flash,gemini-flash-lite-latest,gemini-3.5-flash")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  // Per-org cost guardrail for Stage E's AI explanations -- see routes/findings.ts.
  aiExplanationDailyLimit: Number(process.env.AI_EXPLANATION_DAILY_LIMIT ?? 100),
  // How many recheck jobs (each launching a Chromium instance via the scanner) run at
  // once -- see queue/dispatch.ts. Default of 3 is unchanged local/CI behavior; a
  // RAM-constrained deployment (e.g. Render's free 512MB, shared with api+scanner in one
  // container) overrides this down to 1, since more than one concurrent Chromium instance
  // there risks taking down the whole container, not just the scan.
  recheckConcurrency: Number(process.env.RECHECK_CONCURRENCY ?? 3),
  // Cloudflare Turnstile secret for the public report form (lib/publicReports.ts). Empty =
  // no CAPTCHA check. The matching site key goes to the web app as
  // NEXT_PUBLIC_TURNSTILE_SITE_KEY.
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? "",
  // Tavily web search for social-account and fact-check discovery (lib/tavily.ts). Empty =
  // those jobs don't run. The cap stays under the free plan's 1,000 credits/month.
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  // Contact (email or URL) sent in the User-Agent to SANS ISC's recent-domains feed, which
  // asks automated clients to identify themselves (lib/iscRecentDomains.ts). Optional.
  iscContact: process.env.ISC_CONTACT ?? "",
  // CT log operators whose names tiles are read (pipeline/ctMonitorJob.ts), comma-separated
  // as named in Google's log list. Default: Let's Encrypt only (~1.3 GB/day, ~70% of new
  // names). "all" = every operator that serves names tiles (~3.2 GB/day, ~84%).
  ctLogOperators: ((v) => (v.toLowerCase() === "all" ? [] : v.split(",").map((s) => s.trim()).filter(Boolean)))(
    process.env.CT_LOG_OPERATORS ?? "Let's Encrypt"
  ),
  tavilyMonthlyCap: Number(process.env.TAVILY_MONTHLY_CAP ?? 900),
};
