# Brand Monitor

MVP build of the brand-impersonation detection platform described in `ARCHITECTURE.md`:
**register a brand → discover lookalike domains → enrich → score explainably → alert on change.**
Started as a single-tenant POC against Jambojet (`jambojet.com`); now a real multi-tenant
build with Clerk auth, Postgres row-level security, and a background job system doing
continuous discovery + recheck rather than one manual pass. See the plan referenced in
each stage's git history for the reasoning behind specific decisions (Clerk vs. custom
auth, pg-boss vs. Redis, the `Scan` batching model, etc.) — this file covers setup/run only.

## Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for Postgres and the containerized Playwright scanner)
- A Clerk application (Organizations enabled, with custom roles `owner`/`admin`/`analyst`/`viewer`
  added under Organizations → Roles — Clerk only ships `admin`/`member` by default)

## Setup

```bash
# 1. Install dependencies. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD keeps Chromium off your host --
#    the scanner service runs Playwright inside Docker only.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install

# 2. Start Postgres + the containerized scanner (first run downloads images, a few GB)
docker compose up -d --build

# 3. Configure env (fill in real values -- see each .env.example for what's needed,
#    including your Clerk publishable/secret keys)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local

# 4. Create the schema (also creates the restricted brandmonitor_app DB role used at
#    runtime, and its RLS policies -- see prisma/migrations/*/migration.sql)
npm run prisma:migrate

# 5. One-time per environment: bootstrap pg-boss's own schema and grant brandmonitor_app
#    narrow access to it. Re-run only after a pg-boss version upgrade ships an internal
#    schema migration.
npm run queue:bootstrap

# 6. Seed a demo brand. Once you've signed in once via the app and created/joined a real
#    Clerk organization, re-run this with SEED_ORG_ID (and SEED_USER_ID/SEED_USER_EMAIL)
#    set to your real Clerk ids so the seeded data is reachable through your actual login
#    -- a placeholder id here is invisible to any real session (RLS correctly hides it).
npm run prisma:seed
```

## Run

In two terminals:

```bash
npm run dev:api   # http://localhost:4000 -- also boots the in-process job queue/workers
npm run dev:web   # http://localhost:3000
```

Sign in (or create an organization) at `localhost:3000`, then open `/dashboard`. If your org
has no brand yet, a short form lets you create one. Click **Run discovery** to kick off an
immediate pass, or just wait — the same detection loop also runs continuously in the
background:

- **Discovery** (every 4h per brand, or on-demand via the button): generates typosquat/
  homoglyph candidate domains, DNS-checks them, and creates a bare (unscored) finding for
  anything newly registered.
- **Recheck** (every 5 minutes, picks up anything due): does the actual enrichment — RDAP/
  WHOIS, website scan, favicon match, scoring — for one finding at a time, on a cadence that
  starts aggressive (every ~20min in a finding's first 72h) and backs off with age. A
  brand-new finding typically gets its first real score within minutes, not immediately.
- **Alerting**: every org gets a default rule (alert on severity crossing into "high") the
  moment it's created (or, for orgs from before this shipped, backfilled by the alerting
  migration). Fires by email (SMTP — see `.env.example`), an in-app notification (bell icon
  in the header), and/or a webhook if one's configured (`PUT /api/webhook-config` — no
  settings UI yet). More rule kinds (`score_increase`, `new_finding`) exist and work, just
  aren't auto-seeded; add one directly via `alert_rules` until a rules UI exists.
- **Lifecycle**: a finding's status (`new → investigating → confirmed/false_positive →
  resolved`), assignee, and tags are editable from its detail page — `resolved`/
  `false_positive` also stop it from being picked up for further automatic rechecks. Notes
  are a simple threaded log on the same page.
- **Manual submission**: paste a URL on the dashboard to report a suspicious page discovery
  can't reach on its own — most notably a fake social-media profile, since platforms like
  Instagram/Facebook have no discovery API to search (see `ARCHITECTURE.md`). A bare domain
  is treated like any discovered domain (full WHOIS/DNS/favicon enrichment, ongoing
  recheck cadence); a path-bearing URL (e.g. a specific profile page) is scanned and scored
  as that exact page — WHOIS/DNS/favicon checks are skipped for it since domain-registration
  facts about someone else's platform say nothing about one fake profile hosted there — but
  it still stays enrolled in the normal recheck cadence, not just scored once.
- **Dormant-domain watch**: a registered typosquat with nothing hosted on it yet (a parked
  page, or a cloud platform's default "not deployed" placeholder) is rechecked every 20
  minutes indefinitely — not backing off with age like a normal finding — specifically so
  the moment it starts serving real content gets caught fast. A dedicated `website_activated`
  alert rule (auto-seeded per org, same as the default severity alert) fires the first time
  that happens, separately from the regular severity/score alerts.
- **AI explanation**: a "Generate AI explanation" button on a finding's detail page asks
  Claude to narrate its deterministic score/evidence in plain English — the score itself is
  never set or influenced by the model, only explained after the fact (see `ARCHITECTURE.md`
  §9). Explanations are cached per scan (never regenerated for an unchanged scan) and
  rate-limited per org (`AI_EXPLANATION_DAILY_LIMIT`, default 100/day) since each call spends
  real Anthropic budget. Requires `ANTHROPIC_API_KEY` in `.env` — the button surfaces a clear
  error if it's missing/invalid rather than failing silently.
- **Takedown tracking**: a finding's detail page lets you log takedown requests (provider —
  e.g. registrar/hosting provider, an optional ticket reference, notes) and track each one's
  status (`requested → acknowledged → completed/rejected`) independently — a finding can have
  several in flight at once. Pure record-keeping: nothing here ever calls a registrar/hosting
  provider's actual API.

## What to expect

- Most WHOIS/RDAP lookups for `.co.ke` and similar ccTLDs come back empty — expected (see
  `apps/api/src/lib/whois.ts`); the finding is still created, just without an age signal.
- A brand's own allowlisted domains are filtered out of the candidate set, so they never
  show up as a false-positive "threat."
- A finding's "why this score" breakdown always reflects only its *latest* scan, not a
  running history — score/evidence history is append-only underneath (see the `Scan` model
  in `schema.prisma`) but the UI/API deliberately show only the current batch.
- Everything queried is public data (DNS, RDAP/WHOIS, public web pages) — see `ARCHITECTURE.md`
  §14/§33. If a run surfaces a genuinely live phishing domain, that's a real finding worth
  responsibly flagging to the brand's own security team.

## Project layout

```
apps/
  api/       Fastify + Prisma + TypeScript -- auth, RLS-scoped routes, detection pipeline,
             pg-boss job queue (apps/api/src/queue/), REST API
  web/       Next.js dashboard/threat-feed/threat-detail UI, Clerk-backed auth
  scanner/   Playwright, containerized -- headless page fetch/screenshot/form-detection
packages/
  shared/    Zod schemas + types shared by api and web
```

Table/field names in `apps/api/prisma/schema.prisma` intentionally match `ARCHITECTURE.md` §7.
