# Deploying Brand Monitor for free

Three services, three providers, all free tier as of September 2026 (free tiers change —
re-check before relying on this months later):

| Piece | Where | Why |
|---|---|---|
| `apps/web` (Next.js) | Vercel | first-party Next.js hosting, generous free tier |
| Postgres | Neon | free tier's default role has `CREATEROLE`, which the RLS migration needs |
| `apps/api` + `apps/scanner` | Oracle Cloud Always Free VM | needs to be always-on (pg-boss queue worker, RLS session vars) and have enough RAM for headless Chromium — no serverless/free-tier PaaS fits both, self-hosting on a real always-free VM does |

The API **must** be served over real HTTPS, not just HTTP on a port — `apps/web`'s client
components call the API directly from the browser (see `apiFetch` usage in
`app/dashboard/page.tsx`), and a browser on `https://*.vercel.app` will block a plain-HTTP
API origin as mixed content. That's why Caddy (automatic Let's Encrypt) is part of this
setup rather than optional polish.

**Domain**: no separate account/signup needed for this. [sslip.io](https://sslip.io) is a
free, zero-signup wildcard DNS service — a hostname like `140.238.12.34.sslip.io`
automatically resolves to that exact IP (computed on the fly, no account, nothing to
expire or reconfirm). It works with Caddy's automatic HTTPS exactly like a normal domain
would — Let's Encrypt just sees a normal DNS A-record lookup. The Oracle VM step below
derives this once the VM's public IP is known. (If you'd rather have a memorable name
instead of an IP-encoded one, [DuckDNS](https://duckdns.org) is the standard free
alternative — needs a quick GitHub/Google-login signup, but the resulting hostname stays
fixed even if you ever change VMs/IPs, unlike an sslip.io one.)

## 1. Neon (Postgres)

1. Create a free project at [neon.tech](https://neon.tech).
2. Copy the **direct** (non-pooled) connection string — not the pooled/PgBouncer one. This
   app is a long-running server managing its own Prisma pool, not a serverless function
   making many short-lived connections, so the pooler (built for the latter) just adds a
   variable worth avoiding.
3. That's it for now — the `brandmonitor_app` role gets created automatically when the
   RLS migration runs in step 5.

## 2. Oracle Cloud (VM for `apps/api` + `apps/scanner`)

1. Create an **Always Free Ampere A1** VM instance (Compute → Create Instance → Ampere;
   pick the Always Free shape). If you hit "out of host capacity", try a different
   availability domain or region — this is a known, common, and usually transient issue
   for this specific free shape, not a real quota problem.
2. While creating it (or after, via the instance's attached VNIC), assign a **Reserved
   Public IP**, not an ephemeral one — both are free on Always Free, but an ephemeral IP
   can change if the instance is ever stopped/restarted, which would silently break the
   sslip.io hostname below (it has the IP baked in). A reserved IP stays fixed.
3. Once you have that IP (e.g. `140.238.12.34`), your API domain is simply
   `140-238-12-34.sslip.io` (dashes, not dots — sslip.io accepts either, dashes avoid any
   ambiguity with the rest of the hostname) — no signup, nothing to configure, it resolves
   immediately.
4. In the VM's attached Virtual Cloud Network security list (or the VM's own iptables if
   you're using Oracle's newer VCN-native firewall), open inbound TCP **80** and **443**.
   Leave everything else closed — `apps/api` and `apps/scanner`'s own ports are never
   published to the host at all (see `docker-compose.prod.yml`), so nothing else needs a
   hole punched for them.
5. SSH in, install Docker + the Compose plugin (`curl -fsSL https://get.docker.com | sh`,
   then `apt-get install docker-compose-plugin` or follow Docker's current install docs —
   commands drift, check docker.com for the current one-liner).
6. `git clone` this repo onto the VM.
7. `cp apps/api/.env.production.example apps/api/.env.production` and fill in every value
   — Neon's connection strings from step 1 (pick a real password for `brandmonitor_app`,
   not the dev default), your Clerk **production** instance keys (see step 4 below), SMTP,
   Anthropic key, and `WEB_APP_URL` set to your eventual Vercel URL.
8. Create a root `.env` file (next to `docker-compose.prod.yml`, gitignored) containing
   `API_DOMAIN=140-238-12-34.sslip.io` (your actual reserved IP, sslip.io-ified) — Compose
   reads this automatically to fill in the Caddyfile's `{$API_DOMAIN}`.
9. `docker compose -f docker-compose.prod.yml up -d --build`. The `api` container's
   entrypoint runs `prisma migrate deploy`, syncs `brandmonitor_app`'s password with
   `DATABASE_APP_URL`, then bootstraps the pg-boss grants — all automatically, on every
   start, no separate manual step on this or any future deploy.
10. Confirm `https://140-238-12-34.sslip.io/health` returns `{"ok":true}` (may take a
    minute the first time while Caddy provisions its certificate).

## 3. Clerk (switch from dev instance to production)

The instance used during local development (`exotic-gnat-47.accounts.dev` or similar) is a
**dev instance** — it has restrictions not meant for a real deployed domain. In the Clerk
dashboard: create a **Production** instance, add your Vercel domain and `API_DOMAIN` to
its allowed origins, and point its webhook to
`https://140-238-12-34.sslip.io/api/webhooks/clerk` (your real API domain, the route
`apps/api/src/routes/webhooks.ts` already implements it). Use the production instance's
keys in both `apps/api/.env.production` (step 2.7) and Vercel's env vars (step 4.3) — not
the dev keys.

## 4. Vercel (`apps/web`)

1. Import this repo as a new Vercel project.
2. Set **Root Directory** to `apps/web` in the project settings. Vercel auto-detects the
   npm-workspaces monorepo from the root `package.json` and runs `npm install` from the
   repo root itself — no `vercel.json` needed.
3. Set environment variables: `NEXT_PUBLIC_API_URL=https://140-238-12-34.sslip.io` (your
   real API domain), plus the Clerk **production** publishable/secret keys from step 3.
4. Deploy. Once it's live, go back to Clerk and add the final `*.vercel.app` (or custom)
   domain to the production instance's allowed origins if you didn't already.

## 5. Smoke test

Open the deployed Vercel URL, sign in, confirm the dashboard loads real data (proves the
browser → Vercel → API-over-HTTPS → Neon path works end to end), then run a discovery scan
(proves `api` → `scanner` over the internal Docker network works).
