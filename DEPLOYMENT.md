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
traffic to keep the container from ever sleeping in practice.

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
