# Deploying Brand Monitor

| Piece | Where | Cost |
|---|---|---|
| `apps/web` (Next.js) | Vercel (Hobby) | free |
| `apps/api` + `apps/scanner` (one container) | OVH VPS (VPS-2: 4 vCores, 8 GB RAM, 75 GB, Beauharnois CA) running Dokploy | the one paid item |
| Postgres 18 | Same VPS: one **shared** Postgres server in Dokploy, used by every app on the box; each app gets its own database + role | (VPS) |
| Auth | Clerk **dev** instance (see §4) | free |
| Monitoring | UptimeRobot on `/health/jobs` | free |

Live (since 2026-11-19): web `https://brand-monitor-web-eta.vercel.app`, API
`https://brand-monitor-api.gabrielochieng.com`. Dokploy panel: `panel.gabrielochieng.com`.
Both Vercel and Dokploy auto-deploy on every push to `main`.

Budget rule: the VPS is the only paid item. Everything else stays on free tiers with no card.

`apps/api` and `apps/scanner` run as **two processes in one container** (`apps/api/Dockerfile`,
`docker-entrypoint.sh`); the API reaches the scanner on `127.0.0.1:3100`, never exposed. This was
forced by Render's free tier originally and is kept because it's simple. Local dev still runs
the scanner as its own container (root `docker-compose.yml`).

## 1. Shared Postgres (Dokploy project `infra`, service `postgres-shared`)

Created once for the whole VPS. Image **`postgres:18`**, superuser `postgres`, **no external
port** (reachable only on Dokploy's internal network, host `infra-postgresshared-zdz0e1:5432`).

**Do not set `PGDATA`.** Dokploy (v0.31) mounts its persistent volume at
`/var/lib/postgresql/18/docker`, which is the postgres:18 image's default `PGDATA`. Setting
`PGDATA=/var/lib/postgresql/data` (the pre-18 path) puts the data in an anonymous volume that's
recreated empty on every reload; this happened during setup. To check, run
`echo $PGDATA; grep postgresql /proc/mounts` in the container terminal: `PGDATA` must be one of
the mounted paths.

Adding an app's database (container terminal → `psql -U postgres`):

```sql
CREATE ROLE <app> LOGIN;              -- brand-monitor needs: LOGIN CREATEROLE BYPASSRLS
\password <app>                       -- avoids quoting problems; letters+digits only (it goes in a URL)
CREATE DATABASE <app> OWNER <app>;
REVOKE ALL ON DATABASE <app> FROM PUBLIC;
```

**Brand-monitor's owner role (`brandmonitor`) needs `CREATEROLE` and `BYPASSRLS`, not superuser:**
- `CREATEROLE`: the RLS migration creates the `brandmonitor_app` role.
- `BYPASSRLS`: every table has `FORCE ROW LEVEL SECURITY`, and `adminPrisma` (webhook sync, the
  cross-tenant recheck dispatcher) connects as this role. Without it the dispatcher silently sees
  zero rows. Neon's owner role had this implicitly through `neon_superuser`.

Everything else (`prisma migrate deploy`, the `brandmonitor_app` password, pg-boss grants) is
handled by the API container's entrypoint on every start. Tested against Postgres 18 as a
non-superuser on 2026-11-19.

## 2. API (Dokploy project `brand-monitor`, Application)

- Provider GitHub, branch `main`, auto-deploy on.
- Build type **Dockerfile**: file `apps/api/Dockerfile`, context path `.` (repo root; it's an
  npm-workspaces monorepo and needs the root lockfile).
- Domain `brand-monitor-api.gabrielochieng.com` → container port **4000**, HTTPS via Let's
  Encrypt (Dokploy's Traefik). DNS: A record `brand-monitor-api` → `198.245.56.186`.
- Volume `brand-monitor-screenshots` → `/app/apps/api/screenshots` (finding screenshots; served at
  `/screenshots/`). Mounts only apply after a redeploy. Verify in the container terminal:
  `grep screenshots /proc/mounts` must print a line. On 2026-11-20 it printed nothing (the volume
  wasn't mounted, so every deploy had wiped all screenshots); mounted and verified the same day.
- Environment: see `apps/api/.env.production.example`. The database URLs use the internal host:
  ```
  DATABASE_URL=postgresql://brandmonitor:<pw>@infra-postgresshared-zdz0e1:5432/brandmonitor
  DATABASE_APP_URL=postgresql://brandmonitor_app:<pw>@infra-postgresshared-zdz0e1:5432/brandmonitor
  ```
  Don't set `PORT` (defaults to 4000).

Every start runs migrations, syncs `brandmonitor_app`'s password with `DATABASE_APP_URL`,
bootstraps the pg-boss grants, then starts the scanner and API. If either process dies the
container exits and Dokploy restarts it.

Confirm with `https://brand-monitor-api.gabrielochieng.com/health` → `{"ok":true}`.

## 3. Vercel (`apps/web`)

1. Import the repo as a Vercel project with **Root Directory** `apps/web` (Vercel runs
   `npm install` from the repo root itself; no `vercel.json`).
2. Env vars: `NEXT_PUBLIC_API_URL=https://brand-monitor-api.gabrielochieng.com` plus the Clerk dev
   instance's publishable/secret keys. `NEXT_PUBLIC_*` values are baked into the browser bundle at
   build time: add them as type **Config**, not Secret (Vercel refuses public-prefixed secrets and
   can't convert a saved secret), and **redeploy** after changing them.
3. `WEB_APP_URL` on the API must exactly equal the Vercel origin (see §6).
4. Optional, public report form (`/report/<token>`): a free Cloudflare **Turnstile** widget for the
   Vercel hostname; `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on Vercel, `TURNSTILE_SECRET_KEY` on the API.
   Set both or neither: with only the site key the form shows a check the API ignores; with only
   the secret every report fails `captcha_failed`. Without them the form relies on a honeypot
   field and a 5-per-hour per-IP limit. Reports trigger at most 30 scans per brand per day.
5. Optional, social-account, web and fact-check search: a free Tavily key (tavily.com, no card,
   1,000 searches/month; never enable pay-as-you-go) as `TAVILY_API_KEY` on the API. Without it
   those jobs do nothing. `TAVILY_MONTHLY_CAP` (default 900) is a hard stop counted in
   `provider_usage`; each brand uses ~276/month (so ~3 brands fit). Then add each brand's official social accounts
   and WhatsApp link under **Settings → Official accounts and apps**, or its own accounts get reported.

## 4. Clerk — deliberately staying on the dev instance

**This deployment runs on Clerk's free development instance permanently.** Production mode needs
a custom domain with DNS control; when this was decided there was none (`*.vercel.app` is
rejected). `gabrielochieng.com` now exists, so production is possible, but for a small internal
team tool the dev instance's only downsides are a "Development mode" watermark and Clerk's shared
OAuth credentials. Revisit only if the app needs public sign-ups.

Webhook: Clerk dashboard → Developers → Webhooks, endpoint
`https://brand-monitor-api.gabrielochieng.com/api/webhooks/clerk`, subscribed to
`organization.created`, `organization.updated`, `user.created`, `user.updated`,
`organizationMembership.created`, `organizationMembership.updated`,
`organizationMembership.deleted`. Its signing secret → `CLERK_WEBHOOK_SIGNING_SECRET`; the dev
instance's secret key → `CLERK_SECRET_KEY` (the same dev keys `apps/web/.env.local` uses).

**Roles are not configured in Clerk.** Role (`owner`/`admin`/`analyst`/`viewer`) is managed in-app
under Settings → Team (see `apps/api/src/lib/auth.ts`, `VALID_ROLES`). The org creator becomes `owner`,
invitees start as `viewer`. **Clerk's own Admin/Member toggle has no effect on this app**, so
don't "fix" someone's access from the Clerk side.

## 5. Smoke test

Sign in on the Vercel URL and confirm the dashboard shows real data (browser → Vercel → API →
Postgres). `/health/jobs` should show a `lastRecheckDispatchAt` within the last 5 minutes. To see
the scanner work end to end, submit a live URL as a manual finding: its screenshot should load.

## 6. Operating it — things that bite

**`WEB_APP_URL` must exactly equal the Vercel origin** (scheme + host, no trailing slash). The API
uses it for email links *and* as the CORS allowlist (`apps/api/src/server.ts`; `localhost` /
`127.0.0.1` on any port are always allowed for dev). Wrong value → the browser blocks every
frontend request with a CORS error. It also needs setting in Clerk → Developers → Paths →
*Fallback development host*, or invitation emails link to `localhost:3000`.

**The VPS is shared** with other apps (cve-monitor, and more to come); new apps' databases go on
the shared Postgres server (§1). Brand-monitor's container holds headless Chromium; `RECHECK_CONCURRENCY=3` means up to 3
browsers at once (~0.5–0.7 GB each). Raise it only after checking free RAM in Dokploy →
Monitoring.

**Querying production:** the database has no public port. Use the `postgres-shared` container
terminal in Dokploy (`psql -U postgres -d brandmonitor`; as superuser it bypasses RLS). To run a
local script against it, temporarily set an External Port on the service, or open an SSH tunnel,
and close it afterwards.

**Backups: not set up yet.** Dokploy can schedule `pg_dump` backups to S3-compatible storage
(service → Backups); a free off-site target with no card is still to be chosen. Until then a lost
VPS disk loses the data.

**Email over SMTP from OVH: not yet confirmed.** Render's free tier blocked outbound SMTP, which is
why email alerts never worked in production. OVH VPSes normally allow it. Check after the next
alert: `SELECT channel, status, count(*), max(error) FROM alert_deliveries GROUP BY 1, 2;`

**pg-boss polling is still tuned for Render's old 5 GB/month bandwidth cap** (~30 MB/day instead
of ~400). It's harmless on the VPS; read the comment in `apps/api/src/queue/boss.ts` before
changing any interval (raising `cronMonitorIntervalSeconds` silently stops all cron jobs). Other
bandwidth-motivated choices that still stand: dormant findings are rechecked hourly (20 min in
their first 3 days), fonts/media are blocked in the scanner, and the phishing feed uses the small
feed (~35 KB/hour), not `feed.json`.

**Rate limits** (`lib/rateLimit.ts`, in memory, reset on restart): 300 requests/min and 60
`/screenshots/` files/min per IP (`/health*` exempt), plus per org 12 manual discovery runs and 50
manual submissions per 24h. Discovery runs need analyst or above. Per-IP keys come from
X-Forwarded-For (`trustProxy`, behind Traefik) and can be spoofed; the per-org limits are the ones
that hold.

**How to confirm jobs are actually running** (don't trust log silence: the monitor jobs log
nothing on a normal run):

- Fastest: `GET /health/jobs`: 200 with a recent `lastRecheckDispatchAt`, or 503 once jobs have
  stalled for 15 min. It also reports `sources.ct_log` / `nrd` / `phish_feed` / `google_play` / `social_search`
  (last successful query; `stale` after 24h / 48h / 6h / 24h / 48h; social only when `TAVILY_API_KEY` is
  set) and `tavilyUsage`. `GET /health/jobs?sources=1` also returns 503 when a source is stale.
  UptimeRobot watches it with email alerts on. Stale since the last restart just means it hasn't
  succeeded *since that restart*.
- Registered schedules: `SELECT name, cron FROM pgboss.schedule;`. Expect `dispatch-discovery`
  (`0 */4 * * *`), `dispatch-recheck` (`*/5 * * * *`), `dispatch-ct-monitor` (`*/30 * * * *`),
  `dispatch-app-store-monitor` (`0 */4 * * *`), `nrd-monitor` (`15 */6 * * *`),
  `phish-feed-monitor` (`40 * * * *`), and `social-search-monitor` twice (`20 6 * * *` key `social`,
  `50 6 * * 1` key `fact_check`).
- Scan history (pg-boss v12 deletes completed jobs, so use the app's tables):
  `SELECT date_trunc('hour', started_at), count(*), count(error) FROM scans GROUP BY 1 ORDER BY 1 DESC LIMIT 24;`
  Rechecks follow each finding's cadence, so a quiet hour is normal when nothing is due.
- Zero findings from `app_store` / `google_play` is normal. Zero from `ct_log` is **not** proof nothing exists:
  crt.sh fails so often that CT monitoring has never produced a finding in production.

**Never leave a local `npm run dev` running.** Its recheck dispatcher runs against the local DB and
sends real alert emails (using the local SMTP config) to a real inbox, with links to `localhost`.

## 7. History: the free Render + Neon setup (until 2026-11-19)

Until 2026-11-19 the API ran on Render's free tier and Postgres on Neon's free tier. It was
retired because:
- **Render's free workspace allows 5 GB/month of outbound bandwidth**, then suspends everything
  until the 1st. That caused the 2026-09-25 → 10-06 outage, and production stopped again on
  **2026-10-22** (last scan in Neon 21:44 UTC) and stayed down until the move. No alerts went out
  in that period.
- Render's free tier blocks outbound SMTP, so email alerts never worked there.
- The instance slept after 15 min without inbound HTTP (needed an UptimeRobot keep-alive), had
  512 MB RAM (`RECHECK_CONCURRENCY=1`), and lost screenshots on every deploy.
- Neon auto-suspended, so the first connection after idle often failed.

Migration (2026-11-19): data-only `pg_dump` of the `public` schema from Neon (excluding
`_prisma_migrations`; schema came from the migrations, pg-boss schedules re-register on start),
restored with `pg_restore --data-only --disable-triggers` as the superuser. All 26 tables / 32,037
rows matched. Neon and the suspended Render service are kept until ~2026-11-26 as a rollback, then
deleted.
