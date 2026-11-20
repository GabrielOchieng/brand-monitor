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
  monitor (`app_store`), phishing feed (`phish_feed`, phishunt.io), social search (`social_search`,
  Tavily; `type` `social`, never scanned -- `pipeline/socialFindings.ts`), manual submission, public
  scam reports (`public_report`, `routes/publicReports.ts` -- the only unauthenticated write route).
  `Finding.source` is a free-text string; `type` is `domain`, `url` or `social`.
- Rechecks also extract contact/payment details from the page (`lib/indicators.ts` ->
  `finding_indicators`); a value shared by two findings links them and scores `SHARED_INDICATOR`.
- Rechecks also diff the registry record between scans (`finding_changes`, `registration_changed`
  alert) and run the post-takedown watch: `resolved` findings are still rechecked, and a confirmed-down
  -> live transition fires `site_reactivated` (`pipeline/registrationChanges.ts`, `pipeline/takedownWatch.ts`).
- On the office network, a web filter (Fortinet) answers DNS for known-bad domains with a block page
  (208.91.112.55, HTTP 403), so local scans of real threats don't match production.
- pg-boss cron (registered in `apps/api/src/queue/dispatch.ts`): discovery 4h, recheck 5min,
  ct-monitor 30min, app-store-monitor 4h, nrd-monitor 6h, phish-feed-monitor 1h and
  social-search-monitor (daily social search + weekly fact-check, two keyed schedules) (global, no dispatcher). Queues are declared in `queue/boss.ts`.

## Deployment (auto-deploys on push to `main`)
Since 2026-11-19: Vercel (web) + an OVH VPS running Dokploy (`panel.gabrielochieng.com`): the API and
scanner in ONE container at `brand-monitor-api.gabrielochieng.com`, and a **shared Postgres 18 server**
(`postgres-shared`, internal host only, no public port) that every app on the VPS uses, each with its own
database + role. Clerk **dev** instance (permanent by decision). UptimeRobot alerts on `/health/jobs`.
Render + Neon are retired (suspended/kept as rollback until ~2026-11-26); see DEPLOYMENT.md §7.

## Hard constraints
- **The only paid item is the owner's existing VPS** (runs Dokploy, panel.gabrielochieng.com, shared with
  another project). Everything else must stay at $0 — no card, no paid tiers, no paid add-ons. Oracle
  Cloud (country block) and GCP ($50 hold) are ruled out. Verify free-tier terms with a web search
  instead of memory — they change.

## Open issues (as of 2026-11-19, priority order)
1. No database backups. Dokploy can back up to S3-compatible storage; needs a free, no-card target.
   Production was down 2026-10-22 -> 11-19 (Render suspension) until the move to the VPS.
2. Email alerts over SMTP: never worked on Render (blocked); unconfirmed on the VPS. Check
   `alert_deliveries` after the next alert before reaching for an HTTPS-API email provider.
3. The parked-page detector sometimes misreads one scan of a live site as parked (score flaps). Alerts are
   debounced since 2026-10-20 (`findings.first_live_at`, `down_streak`); the detector itself isn't fixed.
4. CT monitoring never worked in production: crt.sh is constantly down (502s/timeouts). Failures are
   now logged and shown on `/health/jobs`, but there's no working free substring-search CT source yet.
   The NRD feed is a 70k/day sample and missed `flyjambojetkenya.store`. Keywords can be marked paired
   (`concat_term_core`) in the Keywords panel since 2026-10-20; Jambojet's 6 core words are paired in prod.
5. Smaller: no error tracking; rate limits are in-memory only (`lib/rateLimit.ts`).
6. Screenshots live on a Dokploy volume (mounted 2026-11-20; before that every deploy wiped them),
   not backed up, and each scan overwrites the finding's only screenshot (a dead page can replace
   the last live one, losing takedown evidence). Agreed later plan: move them to Cloudinary's free
   plan (25 credits/month, no card, no overage) and keep one screenshot per scan.

Detection gaps on web and social (vs. enterprise tools) and the phased plan to close them:
`ROADMAP.md`. Update it when a phase ships.

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
- Production Postgres has no public port, so local scripts can't reach it. Ask the owner to run SQL in
  Dokploy's `postgres-shared` container terminal (`psql -U postgres -d brandmonitor`), or to open a
  temporary External Port / SSH tunnel. `apps/api/.env.production` (gitignored) still holds the retired
  Neon URL, valid until Neon is deleted. Never print or commit credentials.
- In Git Bash, `docker exec` container paths get rewritten to Windows paths; prefix with `MSYS_NO_PATHCONV=1`.
- `apps/api/src/env.ts` forces IPv4-first DNS because Node's `fetch` hung on this machine's IPv6 route.
- Python isn't installed; use node for scripting.
