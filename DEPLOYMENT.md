# Deploying Brand Monitor

| Piece | Where | Cost |
|---|---|---|
| `apps/web` (Next.js) | Vercel (Hobby) | free |
| `apps/api` + `apps/scanner` (one container) | OVH VPS (VPS-2: 4 vCores, 8 GB RAM, 75 GB, Beauharnois CA) running Dokploy | the one paid item |
| Postgres 18 | Same VPS: one **shared** Postgres server in Dokploy, used by every app on the box; each app gets its own database + role | (VPS) |
| Auth | Our own (email + password, session cookie), in the API; see §4 | free |
| Monitoring | UptimeRobot on `/health/jobs` | free |

Live (since 2026-11-19): web `https://brand-monitor.gabrielochieng.com` (before the auth cutover: `https://brand-monitor-web-eta.vercel.app`), API
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
2. Env vars: `NEXT_PUBLIC_API_URL=https://brand-monitor-api.gabrielochieng.com`. `NEXT_PUBLIC_*`
   values are baked into the browser bundle at build time: add them as type **Config**, not Secret
   (Vercel refuses public-prefixed secrets and can't convert a saved secret), and **redeploy**
   after changing them. Optional: `NEXT_PUBLIC_CONTACT_EMAIL` = the address the landing page's
   "Request access" button emails (unset = no button; the page still offers Sign in).
3. Custom domain `brand-monitor.gabrielochieng.com` (Vercel → Project → Settings → Domains, plus
   the CNAME Vercel shows, at the DNS host). Required, not cosmetic: the session cookie is set by
   the API for `.gabrielochieng.com`, and the web app's middleware only sees it on a sibling
   subdomain. On the `*.vercel.app` URL everyone is bounced to /login. `WEB_APP_URL` on the API
   must exactly equal this origin (see §6).
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

## 4. Auth (our own since 2026-11; Clerk before)

Sign-in, sessions, invites and password resets live in the API (`apps/api/src/auth/`, README §9).
Nothing to configure outside this repo except these API env vars:

- `WEB_APP_URL=https://brand-monitor.gabrielochieng.com` (CORS, the Origin check, email links)
- `COOKIE_DOMAIN=.gabrielochieng.com` (so the web app's middleware sees the session cookie)
- `AUTH_ENCRYPTION_KEY`: 32 random bytes, base64 (`node -e "console.log(crypto.randomBytes(32).toString('base64'))"`).
  Encrypts 2FA secrets and takedown sender credentials. Keep a copy somewhere safe (password manager): if it's lost or changed, every
  user with 2FA on is locked out until reset with `npm run auth:disable-2fa -- --email <email>`.
- SMTP (already set for alerts): invites and reset links are emailed. If SMTP breaks, invites fail
  with an error in the UI and "forgot password" silently sends nothing.

**Locked out / first account:** in the API container terminal (Dokploy; it opens in `/`, so `cd /app/apps/api` first),
`npm run auth:create-user -- --email <email> --org <orgId>` prints a one-time
set-password link (owner role by default; `--role`, `--send-email` and `--new-org "<name>"` exist).
**Sign in with Google (optional).** Google Cloud Console, any project → *Google Auth Platform*
(formerly "OAuth consent screen"): audience **External**, app name "Brand Monitor", support email;
scopes only `openid`, `email`, `profile`; then **Publish app** (status *In production*: while it's
*Testing*, only listed test users can sign in). Basic scopes don't need Google's app verification.
Then *Clients* → Create client → **Web application**, authorized redirect URI exactly
`https://brand-monitor-api.gabrielochieng.com/auth/google/callback`. On the API set `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `API_PUBLIC_URL=https://brand-monitor-api.gabrielochieng.com`. **If any
step asks for a billing account or card, stop**: leave the vars empty and the Google button just
doesn't appear (the $0 rule). Not verified with a real Google client yet; tested against a fake one.

**Platform admin.** Turn on two-factor sign-in for the account first (the panel refuses admins
without it), then in the API container (`cd /app/apps/api`): `npm run auth:make-admin -- --email
<email>`. `--revoke` removes it. The panel is at `/admin` ("Admin panel" in the avatar menu).

**Automatic takedown reporting** (README §6). `AUTO_TAKEDOWN_ENABLED=1` turns on the dispatcher (queue
`takedown-dispatch`): it then emails real registrars and hosts for orgs that are allowed, set up, turned on
and moved from shadow to live by their owner. Unset = nothing is prepared or sent, and approving a report
by hand is refused too. Set it when the first org is ready for its shadow period. To let an org set it up: its owner connects a sender mailbox, passes a test send and records
an authorization (Settings → Automatic reporting); you read the authorization and its documents on
its `/admin` org page and press **Allow** (audit-logged; refused without an authorization in force).
Sender credentials are encrypted with `AUTH_ENCRYPTION_KEY`: changing the key means every org must
re-enter them. Report drafts no longer default the CERT channel to KE-CIRT: an org adds its national CERT to its own
contact book (Settings → Report recipients; Channel: National CERT, Applies to: Every report). The
platform contact book is at `/admin/contacts`. Never set `TAKEDOWN_SMTP_ALLOW_PRIVATE` here: it would let an org point its SMTP sender
at internal hosts on the VPS (e.g. `postgres-shared`).

Lost authenticator *and* recovery codes: `npm run auth:disable-2fa -- --email <email>` (confirm it's
really them first, out of band). It also signs them out everywhere.

### Cutover from Clerk (one-off)
1. Vercel custom domain (§3 step 3) and the three API env vars above, *before* pushing.
2. Push. Dokploy and Vercel deploy separately, so sign-in is broken for a few minutes in between.
   The migration `20261123120000_own_auth` runs on container start. Existing users, orgs, roles and
   assignments are unchanged (old Clerk ids stay as plain ids).
3. Check the user list first: in `postgres-shared`, `select id, email from users;`. Fix any
   `...@unknown.local` placeholder emails with an `UPDATE`.
4. In the API container, after `cd /app/apps/api`: `npm run auth:migrate-from-clerk` (dry run), then
   with `-- --send`. Each user gets a 7-day "set your password" link.
5. Remove the Clerk env vars from Vercel and the API, and the webhook in the Clerk dashboard. Keep
   the Clerk application about a week as a rollback (revert the commit), then delete it.

## 5. Smoke test

Sign in on `https://brand-monitor.gabrielochieng.com` and confirm the dashboard shows real data (browser → Vercel → API →
Postgres). `/health/jobs` should show a `lastRecheckDispatchAt` within the last 5 minutes. To see
the scanner work end to end, submit a live URL as a manual finding: its screenshot should load.

## 6. Operating it — things that bite

**`WEB_APP_URL` must exactly equal the web app's origin** (`https://brand-monitor.gabrielochieng.com`,
no trailing slash). The API uses it for email links, as the CORS allowlist, and for the Origin check
on every cookie-carrying write (`apps/api/src/auth/origin.ts`; localhost ports are allowed only when
`WEB_APP_URL` is itself localhost). Wrong value → every frontend request fails with a CORS error, or
every save fails `bad_origin`. Wrong or missing `COOKIE_DOMAIN` → sign-in "works" but every page
bounces back to /login.

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

**Email over SMTP from OVH works** (confirmed 2026-11-21). Render's free tier blocked outbound
SMTP, which is why email alerts never worked there. If it breaks: `SELECT channel, status,
count(*), max(error) FROM alert_deliveries GROUP BY 1, 2;`

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
  stalled for 15 min. It also reports `sources.ct_log` / `nrd` / `nrd_hagezi` / `isc_recent` / `phish_feed` / `google_play` / `social_search`
  (last successful query; `stale` after 1h / 48h / 48h / 24h / 6h / 24h / 48h; social only when `TAVILY_API_KEY` is
  set) and `tavilyUsage`. `GET /health/jobs?sources=1` also returns 503 when a source is stale.
  UptimeRobot watches it with email alerts on. Stale since the last restart just means it hasn't
  succeeded *since that restart*.
- Registered schedules: `SELECT name, cron FROM pgboss.schedule;`. Expect `dispatch-discovery`
  (`0 */4 * * *`), `dispatch-recheck` (`*/5 * * * *`), `ct-tiles-monitor` (`2-59/5 * * * *`),
  `dispatch-app-store-monitor` (`0 */4 * * *`), `nrd-monitor` (`15 */6 * * *`),
  `phish-feed-monitor` (`40 * * * *`), and `social-search-monitor` twice (`20 6 * * *` key `social`,
  `50 6 * * 1` key `fact_check`).
- Scan history (pg-boss v12 deletes completed jobs, so use the app's tables):
  `SELECT date_trunc('hour', started_at), count(*), count(error) FROM scans GROUP BY 1 ORDER BY 1 DESC LIMIT 24;`
  Rechecks follow each finding's cadence, so a quiet hour is normal when nothing is due.
- Zero findings from `app_store` / `google_play` is normal. Zero from `ct_log` is normal for a
  rare brand name; check the `[ct-tiles] N/N logs, … tiles, … entries` log line (every 5 min) and
  `SELECT * FROM ct_log_cursors;` (`updated_at` should be minutes old).

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
