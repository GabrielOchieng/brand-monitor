# Deploying Brand Monitor for free

Three services, three providers, all genuinely free tier as of September 2026 — no card
required anywhere in this setup (free tiers change — re-check before relying on this
months later):

| Piece | Where | Why |
|---|---|---|
| `apps/web` (Next.js) | Vercel | first-party Next.js hosting, generous free tier, no card |
| Postgres | Neon | free tier's default role has `CREATEROLE`, which the RLS migration needs |
| `apps/api` + `apps/scanner` (one container) | Render | free Web Service needs no card at all — the only provider found that doesn't, after Oracle Cloud outright rejected Kenya as a billing country and Google Cloud required a $50 authorization hold |

`apps/api` and `apps/scanner` run as **two processes in one container** on Render, not two
separate services — Render's free tier is 750 instance-hours/month shared across the whole
workspace, enough for one always-on service (~730 hrs) but not two (~1460 combined). See
`apps/api/Dockerfile` and `docker-entrypoint.sh` for how both processes start together;
`apps/scanner`'s own standalone `Dockerfile` and the root `docker-compose.yml` are
unaffected by this — local dev still runs the two as separate containers exactly as before.

**RAM is tight**: Render's free tier is only 512MB total, shared between the Fastify/pg-
boss process and however many headless-Chromium instances the scanner has running at once
in the same container. `RECHECK_CONCURRENCY=1` (see `.env.production.example`) caps that
at one concurrent scan — more than one risks OOM-killing the whole container, not just the
scan. This is a real reliability trade-off versus a bigger machine, accepted deliberately
to stay at $0.

The API is served over real HTTPS automatically — Render gives every Web Service a real
TLS certificate on its own `*.onrender.com` subdomain, no domain purchase, no DNS, no
Caddy/Let's Encrypt setup needed (this is also why `apps/web`'s browser-side calls to the
API — see `apiFetch` usage in `app/dashboard/page.tsx` — won't get blocked as mixed
content: both ends are HTTPS by default).

## 1. Neon (Postgres)

1. Create a free project at [neon.tech](https://neon.tech).
2. Copy the **direct** (non-pooled) connection string — not the pooled/PgBouncer one. This
   app is a long-running server managing its own Prisma pool, not a serverless function
   making many short-lived connections, so the pooler (built for the latter) just adds a
   variable worth avoiding.
3. That's it for now — the `brandmonitor_app` role gets created automatically when the RLS
   migration runs in step 3 below.

## 2. Render (`apps/api` + `apps/scanner`)

1. Create a free account at [render.com](https://render.com) — no card required for the
   free tier.
2. **New → Web Service**, connect this repo.
3. Set **Dockerfile Path** to `apps/api/Dockerfile` and leave the **Docker Build Context
   Directory** as the repo root (`.`) — this exactly matches `docker build -f
   apps/api/Dockerfile .`, already verified working locally.
4. Pick the **Free** instance type.
5. Set **Health Check Path** to `/health` (the existing route needs no changes).
6. Add environment variables from `apps/api/.env.production` (create it from
   `apps/api/.env.production.example` first if you haven't) — Neon's connection strings
   from step 1 (pick a real password for `brandmonitor_app`, not the dev default), your
   Clerk **production** instance keys (see step 3 below), SMTP, Anthropic key,
   `RECHECK_CONCURRENCY=1`, and `WEB_APP_URL` set to your eventual Vercel URL. Do **not**
   set `PORT` — Render injects its own.
7. Deploy. The container's entrypoint runs `prisma migrate deploy`, syncs
   `brandmonitor_app`'s password with `DATABASE_APP_URL`, bootstraps the pg-boss grants,
   then starts both the scanner and api processes — all automatically, on every deploy,
   no separate manual step.
8. Confirm `https://<your-service-name>.onrender.com/health` returns `{"ok":true}`.

**Keep it from sleeping**: Render's free Web Service sleeps after 15 minutes with no
*inbound HTTP* traffic. This matters more than it sounds like it should — pg-boss's own
background polling loop runs continuously inside the same process, but that's internal
activity, not inbound HTTP traffic, so it does **not** by itself keep Render from sleeping
the container. Without a fix, the queue would silently stop making progress for long
stretches whenever nothing happens to hit the API externally. Fix: a free, no-card external
uptime pinger — [UptimeRobot](https://uptimerobot.com) is the standard choice — hitting
`https://<your-service-name>.onrender.com/health` every 5 minutes. That's enough inbound
traffic to keep the container from ever sleeping in practice. Add a **second** monitor, with
email alerts on, at `/health/jobs`: it returns 503 once the scheduled jobs have stalled for 15
minutes (`apps/api/src/queue/health.ts`), which plain `/health` can't detect.

## 3. Clerk — deliberately staying on the dev instance

**Decision: this deployment runs on Clerk's free development instance permanently, not a
production instance.** Clerk's production mode requires a real custom domain with DNS you
control (a `*.vercel.app`/`*.onrender.com` subdomain is explicitly rejected — Clerk needs
to verify ownership via CNAME/TXT records, and neither platform lets you manage records for
its own shared domain). Getting a domain just for this was considered (a free `eu.org`
registration + Cloudflare DNS was the $0-compatible option) but deliberately skipped: for a
small internal team tool like this — not public self-serve signups — the dev instance's
only real downsides are a cosmetic "Development mode" watermark on Clerk's UI widgets and
using Clerk's shared OAuth app credentials instead of your own. Revisit this only if the
app ever needs public/external sign-ups at meaningful volume.

Point the webhook at the deployed API instead of localhost: in the Clerk dashboard →
Developers → Webhooks, add an endpoint at
`https://<your-service-name>.onrender.com/api/webhooks/clerk`, subscribed to
`organization.created`, `organization.updated`, `user.created`, `user.updated`,
`organizationMembership.created`, `organizationMembership.updated`,
`organizationMembership.deleted`. Put its signing secret in
`CLERK_WEBHOOK_SIGNING_SECRET` and the existing dev instance's secret key in
`CLERK_SECRET_KEY` on Render (step 2.6) — the same dev keys `apps/web/.env.local` already
uses locally, not separate production keys.

**Custom org roles are also deliberately not configured on Clerk at all anymore** — even
though the dev instance offers them for free, this app no longer reads role from Clerk.
Role (`owner`/`admin`/`analyst`/`viewer`) is managed entirely in-app now, at `/team` (see
`apps/api/src/lib/auth.ts`'s `VALID_ROLES` comment for the full story) — the org creator
automatically becomes `owner`, anyone invited afterward starts as `viewer` and gets
promoted from `/team` by an owner. **Clerk's own dashboard role toggle (Admin/Member) is
purely cosmetic and has no effect on this app** — a real gotcha for a future reader who
doesn't know this file's history, worth remembering before "fixing" someone's access from
the Clerk side instead of `/team`.

## 4. Vercel (`apps/web`)

1. Import this repo as a new Vercel project.
2. Set **Root Directory** to `apps/web` in the project settings. Vercel auto-detects the
   npm-workspaces monorepo from the root `package.json` and runs `npm install` from the
   repo root itself — no `vercel.json` needed.
3. Set environment variables: `NEXT_PUBLIC_API_URL=https://<your-service-name>.onrender.com`,
   plus the same Clerk dev instance publishable/secret keys used everywhere else (step 3) —
   there are no separate production keys, per the decision in step 3.
4. Deploy, then go back to Render and update `WEB_APP_URL` (step 2.6) to this real Vercel
   URL — it starts as a placeholder since the URL isn't known until this step.

## 5. Smoke test

Open the deployed Vercel URL, sign in, confirm the dashboard loads real data (proves the
browser → Vercel → API-over-HTTPS → Neon path works end to end), then run a discovery scan
(proves `api` → `scanner` inside the same Render container works, and is a real test of the
512MB RAM ceiling under actual load).

Live deployment (as of 2026-10-06): web `https://brand-monitor-web-eta.vercel.app`, API
`https://brand-monitor-api.onrender.com`. Both Render and Vercel auto-deploy on every push to `main`.

## 6. Operating it — things that bite

**`WEB_APP_URL` must exactly equal the Vercel origin** (scheme + host, no trailing slash). The API
uses it for email links *and* as the CORS allowlist (`apps/api/src/server.ts`; `localhost` /
`127.0.0.1` on any port are always allowed for dev). Wrong value → the browser blocks every
frontend request with a CORS error. It also needs setting in Clerk → Developers → Paths →
*Fallback development host*, or invitation emails link to `localhost:3000`.

**Bandwidth is the binding limit: 5 GB/month of outbound traffic per free workspace.** Past that,
with no card on file, Render suspends every service until the 1st of the next month. That is what
stopped production from 2026-09-25 to 2026-10-06 (Render emailed "Workspace suspended — free
bandwidth limit reached"). It counts traffic our container *initiates* — Neon queries, headless
Chromium page loads, WHOIS/RDAP, crt.sh — not just responses to users ([Render docs](https://render.com/docs/outbound-bandwidth)).
The budget is ~165 MB/day. Measured on 2026-10-06 (byte-counting proxy / container net I/O):

- pg-boss idle polling with its defaults: ~400 MB/day sent to Postgres, on its own over budget.
  Now tuned to ~30 MB/day — see the comment in `apps/api/src/queue/boss.ts` before changing any
  interval there (raising `cronMonitorIntervalSeconds` silently stops all cron jobs).
- A scan of a live site: ~1–1.6 MB received, ~0.1 MB sent; a parked page ~40 KB. Fonts/media are
  blocked in the scanner, and dormant findings are rechecked hourly (20 min only in their first 3 days).
- Added 2026-10-07 (estimated, not measured): the NRD feed is ~0.5 MB/day (one zip; up to ~2 MB
  after a restart, which re-downloads the last 4 days), plus one more idle pg-boss worker. Discovery
  grew from ~770 to ~1,170 candidates per run (≈1,640 with `kenya`/`ke` keywords), each 4 small
  DNS queries, roughly 2–4 MB/day in total.

Check usage at Render → the service → **Metrics → Outbound Bandwidth** (broken down by traffic type).
If jobs seem dead, check your email for a suspension notice before anything else.

**The free instance also sleeps** after 15 minutes without inbound HTTP. pg-boss's internal polling
doesn't count, so while it sleeps *no scheduled job runs at all*. The UptimeRobot monitor on
`/health` prevents this; the `/health/jobs` monitor alerts when jobs stall for any reason. A cold
start takes ~35–50s.

**Outbound SMTP is blocked on Render's free tier** (ports 25/465/587; rollout completed by
2026-09-26). The `SMTP_*` env vars therefore cannot work there: every email delivery fails with
`Connection timeout` while in-app notifications and the webhook channel still work. Fix = move to
an HTTPS-API email provider (not done yet). Source: Render changelog, "Free web services will no
longer allow outbound traffic to SMTP ports".

**Neon auto-suspends** when idle; the first connection after a pause often fails — just retry.

**How to confirm jobs are actually running** (don't trust log silence — the monitor jobs log
nothing on a normal run). Query pg-boss directly against the production DB:

- Registered schedules: `SELECT name, cron FROM pgboss.schedule;` — expect `dispatch-discovery`
  (`0 */4 * * *`), `dispatch-recheck` (`*/5 * * * *`), `dispatch-ct-monitor` (`*/30 * * * *`),
  `dispatch-app-store-monitor` (`0 */4 * * *`), `nrd-monitor` (`15 */6 * * *`).
- Fastest check: `GET /health/jobs` — 200 with a recent `lastRecheckDispatchAt`, or 503. It also
  reports `sources.ct_log` / `sources.nrd` (last successful query, `stale` after 24h / 48h), which
  don't affect the status code. `GET /health/jobs?sources=1` returns 503 when a source is stale
  too: point a **second** UptimeRobot monitor at it, so a dead feed alerts without looking like an
  outage. Stale since the last restart just means it hasn't succeeded *since that restart*.
- Recent activity: `SELECT name, state, count(*), max(completed_on) FROM pgboss.job WHERE
  created_on > now() - interval '24 hours' GROUP BY name, state;` — empty means nothing ran.
  pg-boss v12 deletes completed jobs (no archive table), so for history use the app's own
  tables: `SELECT date_trunc('day', started_at), count(*) FROM scans GROUP BY 1 ORDER BY 1;`. Zero findings from `app_store` is normal. Zero from `ct_log` is **not** proof
  nothing exists: crt.sh was down so often that CT monitoring never produced a finding in production.
  Check `sources` on `/health/jobs` before trusting an empty result.
- Email health: `SELECT channel, status, count(*), max(error) FROM alert_deliveries GROUP BY 1, 2;`

**Never leave a local `npm run dev` running.** Its recheck dispatcher runs against the local DB and
sends real alert emails (using the local SMTP config) to a real inbox, with links to `localhost`.
