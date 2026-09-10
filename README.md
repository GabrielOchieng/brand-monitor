# Brand Monitor — POC v0

Proof-of-concept for the brand-impersonation detection loop described in `ARCHITECTURE.md`:
**register a brand → discover lookalike domains → enrich → score explainably → show the result.**
Seeded test brand: Jambojet (`jambojet.com`) — see `ARCHITECTURE.md` and the plan this was built
from for scope/rationale. This is a strict subset of the full MVP: no auth, no multi-tenant
enforcement, no billing, no alerting, no AI layer, no social monitoring — see the top of
`ARCHITECTURE.md` §2/§16 for what's deferred and why.

## Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for Postgres and the containerized Playwright scanner)

## Setup

```bash
# 1. Install dependencies. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD keeps Chromium off your host --
#    the scanner service runs Playwright inside Docker only (see ARCHITECTURE-informed
#    plan: avoids corporate proxy/AV friction with headless Chromium on Windows).
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install

# 2. Start Postgres + the containerized scanner (first run downloads the Playwright image, ~2-3GB)
docker compose up -d --build

# 3. Configure env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local

# 4. Create the schema and seed the Jambojet brand + two guaranteed demo findings
npm run prisma:migrate
npm run prisma:seed
```

## Run

In two terminals:

```bash
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:3000
```

Open http://localhost:3000/dashboard, click **Run discovery**. It generates typosquat/homoglyph
candidate domains for "jambojet", checks which are actually registered, enriches the ones that
are (RDAP/WHOIS, favicon hash, website scan), scores them, and lists them under **Threats** —
alongside the two seeded `seed_demo` findings that are always present regardless of what's live
in the wild that day.

## What to expect

- A run against ~500-900 candidate domains, DNS-checking with concurrency 5, typically takes a
  few minutes — most candidates simply don't resolve (`NXDOMAIN`) and are skipped fast.
- Most WHOIS/RDAP lookups for `.co.ke` and similar ccTLDs will come back empty — that's expected
  (see `apps/api/src/lib/whois.ts`), the finding is still created, just without an age signal.
- `jambojet.com` itself (and anything in its `brand_domains` allowlist) is filtered out of the
  candidate set before scanning, so it never shows up as a false-positive "threat."
- Everything queried is public data (DNS, RDAP/WHOIS, public web pages) — see `ARCHITECTURE.md`
  §14/§33 and the plan's legal/ethical note. If a run surfaces a genuinely live phishing domain,
  that's a real finding worth responsibly flagging to Jambojet's own security team.

## Project layout

```
apps/
  api/       Fastify + Prisma + TypeScript -- pipeline, scoring, REST API
  web/       Next.js dashboard/threat-feed/threat-detail UI
  scanner/   Playwright, containerized -- headless page fetch/screenshot/form-detection
packages/
  shared/    Zod schemas + types shared by api and web
```

Table/field names in `apps/api/prisma/schema.prisma` intentionally match `ARCHITECTURE.md` §7 so
this is forward-compatible with the real multi-tenant MVP, not throwaway scaffolding.
