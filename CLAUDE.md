# Brand Monitor — working notes for Claude

Multi-tenant brand-protection SaaS: detects lookalike domains/apps impersonating a brand, scores
them, alerts analysts. The live test brand is **Jambojet (the owner's real employer)** — scans,
emails and deletions touch real third parties and a real inbox. Be careful.

Read `README.md` (setup/features), `DEPLOYMENT.md` (hosting + operations), and the "As built"
section at the top of `ARCHITECTURE.md` (the rest of that file is the original design and is
partly outdated). **When you ship a feature or change behaviour, update those docs in the same change.**

## Architecture in brief
- npm workspaces: `apps/api` (Fastify + Prisma + pg-boss), `apps/web` (Next.js 15 + Clerk),
  `apps/scanner` (Playwright), `packages/shared`.
- Multi-tenancy = Postgres RLS. All request/pipeline DB access goes through `withTenant(orgId, fn)`
  (`apps/api/src/lib/tenant.ts`). `adminPrisma` is only for webhook sync and cross-tenant dispatch.
- Roles live in our own `Membership.role`, not Clerk (Clerk charges for custom roles). `authenticate()`
  reads userId/orgId from the Clerk JWT and the role from the DB.
- Pipeline: discovery creates findings -> `recheckJob` scans/enriches/scores -> `alertDispatch`.
  Extra finding sources: CT log monitor (`ct_log`), newly-registered-domain feed (`nrd`), App Store
  monitor (`app_store`), manual submission.
  `Finding.source` is a free-text string; `type` is `domain` or `url`.
- Rechecks also diff the registry record between scans (`finding_changes`, `registration_changed`
  alert) and run the post-takedown watch: `resolved` findings are still rechecked, and a confirmed-down
  -> live transition fires `site_reactivated` (`pipeline/registrationChanges.ts`, `pipeline/takedownWatch.ts`).
- On the office network, a web filter (Fortinet) answers DNS for known-bad domains with a block page
  (208.91.112.55, HTTP 403), so local scans of real threats don't match production.
- pg-boss cron (registered in `apps/api/src/queue/dispatch.ts`): discovery 4h, recheck 5min,
  ct-monitor 30min, app-store-monitor 4h, nrd-monitor 6h (global, no dispatcher). Queues are declared in `queue/boss.ts`.

## Deployment (auto-deploys on push to `main`)
Vercel (web) + Render free (API and scanner in ONE container) + Neon (Postgres) + Clerk **dev**
instance (permanent by decision) + UptimeRobot keep-alive on `/health` (alerting monitor on `/health/jobs`).
**Render's free workspace allows 5 GB/month outbound bandwidth, then suspends everything until the 1st** —
anything that adds outbound traffic (polling, scans, external API calls) must be budgeted; see DEPLOYMENT.md §6.

## Hard constraints
- **Everything must stay at $0** — no card, no paid tiers. The owner has said this repeatedly. Oracle
  Cloud (country block) and GCP ($50 hold) are ruled out. Never suggest paid options, and verify free-tier
  terms with a web search instead of memory — they change.

## Open issues (as of 2026-10-06, priority order)
1. Sept 25 -> Oct 6 outage was a Render bandwidth suspension (5 GB/month), not the keep-alive. Fixed
   2026-10-06 by tuning pg-boss polling (~400 -> ~30 MB/day), hourly dormant rechecks, and blocking
   fonts/media in the scanner; `/health/jobs` added for alerting. Watch Render's bandwidth metric.
2. Email alerts fail on Render (free tier blocks outbound SMTP). Needs a free HTTPS-API email provider.
3. `website_activated` re-fires repeatedly when a live site's scan flaps between active and parked.
4. CT monitoring never worked in production: crt.sh is constantly down (502s/timeouts). Failures are
   now logged and shown on `/health/jobs`, but there's no working free substring-search CT source yet.
   The NRD feed is a 70k/day sample and missed `flyjambojetkenya.store`. Brand-settings UI can't mark
   keywords `concat_term_core`, so core-pair candidates never run in prod.
5. Smaller: no error tracking, no API rate limiting, no data export, ThreatsTable "Domain" header shows
   full URLs for `url` findings.

## How to work with the owner
- **Never commit or push unless told "commit and push"** (or equivalent). End commit messages with the
  Co-Authored-By trailer your system provides.
- Non-trivial work: plan first, get approval, then implement.
- Verify with real data, not assumptions: throwaway `tsx` scripts against real Postgres / live APIs,
  deleted afterwards. Run `npx tsc --noEmit -p apps/api` (and `apps/web`) and `npx vitest run`
  (the integration test needs `ALLOW_DB_TESTS=1` and is expected to fail without it).
- The owner is blunt and prefers short answers. When they report a bug, find the real cause first.

## Environment gotchas (Windows, Git Bash)
- Local Postgres (port 5450) and the scanner run via Docker Desktop (`docker compose up -d`).
- **Never leave `npm run dev` (tsx watch) running.** Its recheck dispatcher sends real alert emails to the
  owner's inbox. Stopping a background task does not kill the child node process: find the PID with
  `netstat -ano | grep :4000` and run `taskkill //F //PID <pid>`.
- Neon auto-suspends; the first connection after idle often fails — retry once.
- To query production: throwaway script with `new PrismaClient({ datasources: { db: { url } } })`, reading
  `DATABASE_URL` from `apps/api/.env.production` (gitignored). Never print or commit credentials.
- `apps/api/src/env.ts` forces IPv4-first DNS because Node's `fetch` hung on this machine's IPv6 route.
- Python isn't installed; use node for scripting.
