import path from "node:path";
import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { env } from "./env";
import { pipelineRoutes } from "./routes/pipeline";
import { findingsRoutes } from "./routes/findings";
import { brandRoutes } from "./routes/brands";
import { authRoutes } from "./routes/auth";
import { accountRoutes } from "./routes/account";
import { googleRoutes } from "./routes/google";
import { adminRoutes } from "./routes/admin";
import { notificationsRoutes } from "./routes/notifications";
import { webhookConfigRoutes } from "./routes/webhookConfig";
import { alertRuleRoutes } from "./routes/alertRules";
import { membersRoutes } from "./routes/members";
import { publicReportRoutes } from "./routes/publicReports";
import { mentionRoutes } from "./routes/mentions";
import { takedownAutomationRoutes } from "./routes/takedownAutomation";
import { reportTemplateRoutes } from "./routes/reportTemplates";
import { reportDraftRoutes } from "./routes/reportDrafts";
import { reportRecipientRoutes } from "./routes/reportRecipients";
import { boss, ensureQueues } from "./queue/boss";
import { registerQueueWorkers, scheduleDispatchers } from "./queue/dispatch";
import { registerAlertDispatchWorker } from "./queue/alertDispatch";
import { jobsHealth, sourcesHealth } from "./queue/health";
import { tavilyUsageSnapshot } from "./lib/tavily";
import { allowRequest, allowScreenshot } from "./lib/rateLimit";
import { SESSION_COOKIE, readCookie } from "./auth/sessions";
import { isAllowedOrigin as originAllowed } from "./auth/origin";

const isAllowedOrigin = (origin: string) => originAllowed(origin, env.webAppUrl);

async function main() {
  // trustProxy: Traefik (Dokploy) sits in front of the container, so without it request.ip is the
  // proxy's address and the public report form's per-IP limit (routes/publicReports.ts)
  // would be one shared bucket for every visitor.
  const app = Fastify({ logger: true, trustProxy: true });

  // Per-IP limits, ahead of everything else (including CORS preflights and static files).
  // /health* is exempt: UptimeRobot polls it from shared IPs.
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/health")) return;
    const allowed = request.url.startsWith("/screenshots/") ? allowScreenshot(request.ip) : allowRequest(request.ip);
    if (!allowed) return reply.status(429).header("retry-after", "60").send({ error: "rate_limited" });
  });

  await app.register(cors, {
    // credentials: the web app's fetches send the session cookie.
    credentials: true,
    origin: (origin, cb) => {
      // No Origin header at all -- not a browser CORS request (curl, health checks,
      // UptimeRobot, server-to-server calls) -- always safe to allow.
      if (!origin) return cb(null, true);
      // cb(null, false), not cb(err, false) -- an unrecognized Origin should just get no
      // CORS headers (letting the browser block the response from being read), not a 500.
      // This API gets scanned/probed with arbitrary Origin headers in production; treating
      // every one as a server error would be noisy, misleading log pollution for exactly
      // the outcome CORS is supposed to produce.
      cb(null, isAllowedOrigin(origin));
    },
  });

  // CSRF. The session cookie is SameSite=Lax, which stops other *sites* from sending it on a
  // POST -- but every *.gabrielochieng.com subdomain (the Dokploy panel, other apps on the
  // VPS) counts as the same site. So any state-changing request that carries the cookie must
  // also come from the web app's own origin. Browsers always send Origin on these requests.
  // Registered after CORS so a rejection still carries CORS headers and the page can show it.
  app.addHook("onRequest", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (!readCookie(request, SESSION_COOKIE)) return;
    const origin = request.headers.origin;
    if (!origin || !isAllowedOrigin(origin)) {
      return reply.status(403).send({ error: "bad_origin" });
    }
  });
  // @fastify/static needs its root to exist at registration time, not just by the time a
  // screenshot is first saved (saveScreenshot/ensureBrandScreenshotHash both mkdir lazily,
  // on demand) -- confirmed real: a genuinely fresh container/checkout with zero
  // screenshots saved yet fails this registration outright ("root path ... must exist").
  const screenshotDir = path.join(process.cwd(), "screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: screenshotDir,
    prefix: "/screenshots/",
  });
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(googleRoutes);
  await app.register(adminRoutes);
  await app.register(brandRoutes);
  await app.register(pipelineRoutes);
  await app.register(findingsRoutes);
  await app.register(notificationsRoutes);
  await app.register(webhookConfigRoutes);
  await app.register(alertRuleRoutes);
  await app.register(membersRoutes);
  await app.register(publicReportRoutes);
  await app.register(mentionRoutes);
  await app.register(takedownAutomationRoutes);
  await app.register(reportTemplateRoutes);
  await app.register(reportDraftRoutes);
  await app.register(reportRecipientRoutes);

  app.get("/health", async () => ({ ok: true }));
  // 503 when the scheduled jobs have stalled -- see queue/health.ts. Point the alerting
  // uptime monitor here, not at /health. Detection-source freshness (CT log, NRD feed) is
  // always reported, but only counts toward the status code with ?sources=1, so it can
  // have its own, separate monitor.
  app.get("/health/jobs", async (request, reply) => {
    const jobs = jobsHealth();
    const sources = sourcesHealth();
    const strict = (request.query as { sources?: string }).sources === "1";
    const ok = jobs.ok && (!strict || sources.ok);
    return reply.status(ok ? 200 : 503).send({ ...jobs, ok, sources: sources.sources, tavilyUsage: tavilyUsageSnapshot() });
  });

  // Requires `npm run queue:bootstrap` to have already granted brandmonitor_app access
  // to the pgboss schema -- see scripts/bootstrapQueue.ts.
  if (env.disableSchedulers) {
    app.log.warn("DISABLE_SCHEDULERS=1: no queue workers or dispatchers (nothing scans or sends alerts).");
  } else {
    await boss.start();
    await ensureQueues();
    await registerQueueWorkers();
    await registerAlertDispatchWorker();
    await scheduleDispatchers();
    app.log.info("Queue started: workers registered, dispatchers scheduled.");
  }

  await app.listen({ port: env.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
