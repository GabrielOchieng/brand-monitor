# Brand Protection & Digital Threat Intelligence Platform
## Architecture & Product Design — v0.1 (Pre-Implementation)

Status: **DESIGN ONLY — no code written.** This document is the deliverable for the architecture phase. Nothing here should be built until you explicitly approve scope.

---

## 0. Reality Check — Read This First

Before the design, four assumption-challenges that materially change scope. I'm flagging these because building around false assumptions is the most expensive mistake to make now, not after 3 months of engineering.

**1. This is not a greenfield market.** Brand protection / digital risk protection (DRP) is a real, funded, competitive category: **ZeroFox, BrandShield, Bolster (acquired by Check Point), Red Points, Netcraft, PhishLabs (Fortra), Allure Security, Memcyco, DomainTools/CSC DomainSec, Group-IB, CTM360**. Several of these already do domain monitoring + website analysis + social takedown + correlation, and have years of threat-intel data and abuse-report relationships with registrars/hosts. You are not filling an empty niche — you're entering a market with entrenched, enterprise-priced (often $30k–$250k/yr) incumbents.

  This doesn't mean don't build it. It means: **your wedge has to be specific.** The strongest wedge I can see from this brief: (a) mid-market / SMB pricing the incumbents ignore, (b) verticals and regions incumbents underserve — e.g., African/South Asian/LatAm banks, telcos, airlines, and mobile-money-heavy fintechs where scams run heavily through WhatsApp, Telegram, and mobile money agent numbers rather than the US/EU-centric patterns incumbents tune for, and (c) a genuinely better correlation UX (most incumbent UIs are dated). Decide this before MVP — it changes which data providers and social platforms matter most on day one. This is a decision I'm flagging for you, not making for you.

**2. Social media monitoring cannot do what the brief describes for most platforms.** This is the single biggest gap between "what would be valuable" and "what is legally/technically buildable" in this whole spec. Concretely, as of today:

| Platform | Official API for 3rd-party brand monitoring? | Reality |
|---|---|---|
| **X (Twitter)** | Yes, paid API v2 | Search + filtered stream available on paid tiers ($200/mo Basic → thousands/mo Enterprise). Workable for keyword/username monitoring. |
| **Reddit** | Yes | Data API has free tier + paid tiers; keyword search across public subreddits is feasible. |
| **YouTube** | Yes (Data API v3) | Free quota, search + channel metadata; good for scam-video/comment monitoring. |
| **Telegram** | Partial | Public channels/groups can be joined and read via Bot API/MTProto if you know the channel — but there is **no discovery API** to find "all channels impersonating Brand X." You need seed lists or a data broker. |
| **TikTok** | Very limited | Research API exists but is gated (academic/qualified researchers), not generally available for commercial brand-monitoring products. |
| **Facebook / Instagram — paid/promoted content** | **Yes — Meta Ad Library API** | Official, free, public. Searchable by keyword/advertiser across all active and historical ads on Facebook and Instagram. This is a real, proactive, zero-ToS-risk source for the brief's "fake promotion" / phishing-ad scenario — include it in MVP, not just organic-content monitoring. |
| **Facebook / Instagram — organic content (pages, profiles, posts)** | Effectively no open API; yes via customer-delegated access | Meta shut down public-content search/discovery for third parties years ago — Graph API only returns data for pages/accounts you or a delegated partner have access to. **You cannot search "all Instagram accounts mentioning Brand X" via a global API.** But Meta's **Brand Rights Protection** program, combined with a customer granting your platform **Business Manager partner/delegated access to their own account**, is a real, sanctioned mechanism — the *customer* authorizes you, Meta isn't being scraped. Coverage skews toward IP/counterfeit use cases and requires enrollment + per-customer onboarding, so it's a Phase 2 capability (see §16), not MVP. |
| **LinkedIn** | No public search API for this | Company/people search APIs are locked to partners; not available for a scraping-style brand-monitoring product. No equivalent to Meta's Ad Library or Brand Rights Protection exists here — manual submission remains the honest answer. |
| **WhatsApp** | No | No monitoring surface at all — it's E2E encrypted and closed. Any "WhatsApp scam number" signal has to come from *user reports* or *domains/social posts that mention a WhatsApp number*, not from monitoring WhatsApp itself. |
| **Open web — blogs, forums, news, scam sites (brief §6)** | Yes, via search engines | Not a "social platform" gap at all — the open web is normal, expected crawl territory. Pair a **search API** (Google Programmable Search / Bing Web Search API) for discovery (find pages mentioning the brand + scam keywords) with a page-extraction tool for full content (see Firecrawl, §5.3/§12). |

  **Consequence for the architecture**: Facebook/Instagram organic content, LinkedIn, TikTok, and WhatsApp monitoring **cannot be built via an open, self-serve API at MVP** — but that's narrower than "no legitimate option exists at all." The realistic menu, and the platform should be built to plug in whichever of these you choose without hard-coding an assumption: (a) **Meta Ad Library** for paid/promoted impersonation content — proactive, free, MVP-ready; (b) **customer-delegated Meta Business Manager access + Brand Rights Protection** for organic Meta content — proactive but requires per-customer onboarding, Phase 2; (c) a **licensed third-party threat-intelligence data provider** that has already solved the compliant-access problem (e.g., Recorded Future, Flashpoint, Constella Intelligence, or ZeroFox's own data licensing) — a build-vs-buy call, evaluate cost against building (b) yourself; (d) a **customer-driven reporting flow** (the brand's own social/support team forwards suspicious profile URLs into the platform for enrichment/scoring/correlation) — legally clean, cheap, and the MVP default for LinkedIn/TikTok/WhatsApp-referenced content and for Meta content until (b) is built. Note also that the legal picture for scraping *logged-out, purely public* social content is more contested-but-permissive than it might appear: in *Meta v. Bright Data* (Jan 2024), a federal court rejected most of Meta's claims against scraping logged-out public data, reasoning that a scraper who never agreed to Meta's terms can't be bound by them the way a logged-in user is. That's a real, relevant precedent — but it's one district court, LinkedIn/TikTok haven't had an equivalent ruling, and the platforms will still fight scraping technically (blocking, rate-limiting) regardless of the legal theory. Don't build MVP timeline around it; treat it as a Phase 2 option to revisit with counsel, not a green light. X, Reddit, YouTube, Telegram (seeded), and Meta Ad Library can be genuinely *proactively* monitored at MVP under real, uncontested APIs.

**3. "Detect Copied Logos on Any Website" is a hard, ongoing ML problem, not a checkbox.** Visual/logo similarity detection (perceptual hashing, embedding similarity, screenshot diffing) is doable but needs a maintained reference-image pipeline, a vector index, and tuning to avoid false positives (every bank's website has a blue header and a stock photo of a smiling family). Budget this as a real workstream in Phase 2, not a bullet point in MVP. MVP should do the cheap, deterministic version: favicon hash match, exact/near-exact logo image hash match, and dominant-color extraction — not full visual-similarity ML.

**4. Certificate Transparency + newly-registered-domain feeds have real vendors — this part of the brief is very achievable.** Domain-side monitoring (the actual strongest part of this product) has mature, affordable data sources (CT logs, zone files, WHOIS/RDAP, passive DNS). This should be your MVP center of gravity, both because it's the most legally uncomplicated data source and because it's genuinely where "detect before customers are harmed" is most achievable — a domain can be flagged within minutes of registration, before a phishing kit even goes live.

**Net recommendation**: Build the MVP as a **domain + website intelligence product with a manual/API-fed social & content correlation layer**, not a "we monitor all of social media" product. Market it honestly. This is also *more* defensible against the incumbents, because "fast, explainable, correlated domain-and-website detection with a clean investigation UI" is a real, narrow, winnable wedge, whereas "we monitor everything everywhere" invites a feature-parity fight with ZeroFox that you will lose on data-licensing budget alone.

---

## 1. Product Positioning

### 1.1 Name ideas
(all to be checked for trademark + domain availability before committing)

- **Aegis Watch** / **AegisGuard** — protective, generic enough for any vertical
- **Wraith** — evokes finding the "ghost" impersonators; short, brandable
- **Sentryn** — "sentry" + brand-protection feel, available-sounding
- **Brandshield** — taken (existing competitor), avoid
- **Impersync** — literal (impersonation + sync/correlation), less elegant
- **Halo Watch** — "halo" = brand protection perimeter
- **Origin Shield** — speaks to "verifying the origin/authenticity" angle
- **Truvo** / **Truscape** — "true" + landscape/scope, digital-identity-truth angle
- My pick to workshop first: **Sentryn** or **Aegis Watch** — both read as serious security products, not a marketing tool.

### 1.2 Positioning statement
> "[Product] is the brand-protection platform that tells you not just *that* something mentions your brand, but *whether it's a threat, how severe, and what to do about it* — correlating domains, websites, and social signals into a single investigation, before your customers are harmed."

### 1.3 Target customers
Primary ICP for launch (pick 1–2 to focus GTM, product supports all):
- **Banks & fintechs** (highest willingness to pay, highest regulatory pressure, frequent phishing targets)
- **Airlines & travel** (booking scams, fake refund/compensation scams — your own domain expertise from Jambojet is a real asset here, even though the product itself must stay brand-agnostic)
- **Telecoms & mobile money** (SIM-swap adjacent scams, fake promo/data-bundle scams — huge in African/South Asian markets)
- Secondary: e-commerce, universities (fee/scholarship scams), hotels, government services, SaaS/software companies (fake support/license scams)

### 1.4 Core value proposition
"From 'we found a mention' to 'here's a coordinated campaign, here's the evidence, here's what to do' — in minutes, not weeks, with a risk score you can defend to your board."

---

## 2. MVP Definition (What We're Actually Building First)

Cutting the 34-section brief down to what proves the value prop and is buildable by a small team in ~10–14 weeks:

**In scope for MVP:**
1. Auth + multi-tenant orgs + roles (Owner/Admin/Analyst/Viewer)
2. Brand onboarding (org profile, domains, keywords, logos, official social handles as *reference data*, not monitored via scraping)
3. Domain discovery: CT-log + NRD (newly registered domain) feed ingestion, brand-keyword & fuzzy-match generation and matching
4. Domain intelligence enrichment: WHOIS/RDAP, DNS, hosting/IP, TLS cert data
5. Website analysis (lightweight): headless-browser screenshot, title/meta/text extraction, form detection (login/payment/booking), favicon hash, tech-stack fingerprint, redirect chain
6. Deterministic, explainable risk scoring engine
7. Manual/submitted social & content findings: analysts (or the brand's own team) submit a URL (Instagram post, Facebook page, X account, news article, anything public) → platform fetches what's legally available (oEmbed/public page metadata where allowed, or via the X/Reddit/YouTube APIs where the platform matches), scores and correlates it like any other finding
8. X (Twitter) proactive monitoring via official API (keyword + brand-handle-similarity search), plus **Meta Ad Library API** monitoring for paid/promoted impersonation content on Facebook/Instagram — both are real, free-or-paid official APIs that fit the brief's use case without any ToS risk
9. Basic cross-source correlation (shared IP/nameserver/registrar/domain-linked-from-social) — rule-based, not graph-ML
10. Unified threat feed + dashboard (the 4-question dashboard from the brief)
11. Threat detail / investigation page with evidence + timeline
12. Lifecycle & status workflow (New → Investigating → Confirmed → False Positive → Reported → Resolved), notes, assignees
13. Alerting: email + in-app; one webhook out (generic, so Slack/Teams can be wired via their own webhook URL without custom integration code — real Slack/Teams app integrations are Phase 2)
14. AI layer: threat explanation, summarization, classification (rule-assisted, not sole decision-maker) — one well-scoped LLM integration, not five
15. Manual takedown-tracking workflow (status, notes, provider/registrar reference) — no automated takedown

**Explicitly OUT of MVP** (this is as important as what's in):
- Organic Facebook/Instagram content monitoring via delegated Business Manager access + Brand Rights Protection (real per-customer onboarding lift, Meta-side enrollment latency outside our control — Phase 2), and LinkedIn/TikTok/WhatsApp proactive scanning (no compliant API path at all — see §0)
- Visual/logo similarity ML, homoglyph-rendered screenshot comparison
- Full threat-intelligence graph visualization (data model supports it; UI doesn't render it yet)
- Campaign auto-detection via ML/clustering (MVP correlation is rule-based)
- Slack/Teams native apps, SMS alerting
- Billing/metering enforcement (plans exist as config, not enforced limits — enforce manually/support-assisted at first few customers)
- Email/executive impersonation module
- SSO, SIEM/SOAR integrations, public API for customers

---

## 3. User Journeys

**Journey A — Org onboarding**
Sign up → create org → invite team → create first protected brand → enter domains/keywords/logos/official socials → system runs first discovery pass → dashboard populates within ~30–60 min → first email digest.

**Journey B — New critical threat (the "hero" moment)**
Domain registered → CT log ingestion picks it up within ~1–24h (log-dependent) → brand-keyword match → fuzzy-match score computed → DNS starts resolving → website-analysis job triggers → screenshot + login-form + logo-hash detected → risk score jumps Medium→Critical → correlation engine checks: any social finding already referencing this domain? → alert fires (email + in-app, webhook if configured) → analyst opens investigation → sees timeline, evidence, AI explanation → sets status to "Investigating" → adds note → eventually "Reported" with registrar abuse-ticket reference → "Resolved."

**Journey C — Analyst daily triage**
Analyst logs in → dashboard shows 3 Critical, 7 High since yesterday → filters threat feed by severity=Critical+High, status=New → opens each, reads AI summary, confirms or marks false positive → bulk-assigns confirmed ones to teammate.

**Journey D — Manual social submission**
Support team notices a suspicious Instagram DM campaign → forwards profile URL into platform (via UI paste or a lightweight "report a suspicious profile" form/email-in) → platform fetches public metadata it's allowed to, extracts any linked domains, runs those domains through the full pipeline → correlates back to the submitted profile as evidence → creates a finding either way (scored, with citation to submitter) so it's tracked in the same lifecycle as everything else.

---

## 4. System Architecture

Event-driven, service-oriented, but not over-microserviced for MVP — a modular monolith split along clear service boundaries that can be extracted later without a rewrite.

```
                                   ┌─────────────────┐
                                   │   Next.js Web    │  (customer-facing app)
                                   └────────┬─────────┘
                                            │ REST/GraphQL (normalized API)
                                   ┌────────▼─────────┐
                                   │   API Gateway /    │  authN/Z, tenant scoping,
                                   │   BFF (Node/TS)    │  rate limiting, request validation (Zod)
                                   └────────┬─────────┘
                     ┌──────────────────────┼──────────────────────┐
                     │                      │                      │
            ┌────────▼────────┐   ┌─────────▼────────┐   ┌─────────▼────────┐
            │  Core Domain API  │   │  Investigation/   │   │  Alerting &       │
            │  (orgs, brands,   │   │  Findings API      │   │  Notification API │
            │  users, RBAC)     │   │                    │   │                    │
            └───────────────────┘   └────────────────────┘   └────────────────────┘

                                   ┌─────────────────────┐
                                   │   Event Bus (Kafka /  │
                                   │   or managed: SNS/SQS,│
                                   │   Redis Streams for   │
                                   │   MVP scale)          │
                                   └──────────┬───────────┘
        ┌───────────────┬───────────────┬─────┴──────┬────────────────┬──────────────┐
   ┌────▼────┐    ┌──────▼─────┐   ┌─────▼─────┐  ┌────▼─────┐   ┌──────▼──────┐  ┌────▼────┐
   │ Domain   │    │ Website     │   │ Social/    │  │ Risk      │   │ Correlation │  │ AI      │
   │ Discovery│    │ Analysis    │   │ Content     │  │ Scoring   │   │ Engine      │  │ Service │
   │ Worker   │    │ Worker      │   │ Ingestion   │  │ Engine    │   │             │  │         │
   └────┬────┘    └──────┬─────┘   └─────┬─────┘  └────┬─────┘   └──────┬──────┘  └────┬────┘
        │                │                │              │                │              │
        └────────────────┴──────┬─────────┴──────────────┴────────────────┴──────────────┘
                                 │
                        ┌────────▼─────────┐        ┌──────────────────────┐
                        │   Provider          │        │   Object storage      │
                        │   Abstraction Layer │──────▶│   (screenshots,        │
                        │   (see §7)          │        │   raw HTML, exports)   │
                        └────────┬────────────┘        └──────────────────────┘
                                 │
              ┌──────────────────┼───────────────────────┐
        ┌──────▼─────┐    ┌───────▼──────┐        ┌────────▼────────┐
        │ CT Log /    │    │ WHOIS/RDAP/   │        │ Social Platform  │
        │ NRD Feed    │    │ DNS/IP-Rep    │        │ APIs (X, Reddit, │
        │ Providers   │    │ Providers     │        │ YouTube)         │
        └─────────────┘    └───────────────┘        └──────────────────┘

        Data stores: PostgreSQL (system of record, row-level tenant isolation)
                      + pgvector or dedicated vector DB (Phase 2 similarity search)
                      + Redis (queues, cache, rate limiting)
                      + Object storage (S3-compatible) for screenshots/HTML/evidence
                      + OpenSearch/Elasticsearch (Phase 2, full-text threat feed search)
```

### Event pipeline (matches brief §27)

```
Domain Discovered (from CT log / NRD feed)
   → Normalize (extract registrable domain, TLD, source)
   → Brand Matching (fuzzy match against all tenants' brand keyword sets — see §5.1)
   → [if match] Create Finding (status=New, initial low/medium score from domain signals alone)
   → Enrichment jobs fan out: WHOIS/RDAP, DNS resolve, IP/hosting lookup, TLS cert lookup
   → Risk Score v1 computed
   → [if DNS resolves + HTTP(S) responds] Website Analysis Worker triggered
        → Screenshot, extract text/meta/title, detect forms, favicon hash, tech fingerprint, redirect chain
   → Risk Score recomputed (v2, now includes website signals)
   → Correlation Engine checks: shared infra with existing findings for this tenant? Any social/manual finding referencing this domain?
   → [if correlated] Create/attach to Campaign
   → Risk Score recomputed (v3, includes correlation boost)
   → Threat Created/Updated event → Alerting Engine evaluates tenant alert rules → notify
   → Scheduled re-scan (see below) keeps the finding fresh
```

Because a domain can go from harmless → malicious over hours/days (brief §27 example), every finding gets a **re-scan schedule**: aggressive in the first 72 hours after discovery (e.g., every 15–30 min if the domain has no site yet, backing off to hourly, then daily), then a steady-state cadence (daily/weekly) for older findings that are stable. This is a scheduler + job-queue concern (BullMQ repeatable jobs or equivalent), not a new architectural component.

---

## 5. Detection Methodology

### 5.1 Domain detection
Generate a **candidate permutation set** per brand keyword/domain at onboarding and on brand-config change (not per-scan — precompute and cache):
- Typosquat algorithms: character omission, insertion, transposition, substitution (keyboard-adjacency-weighted), doubling
- Homoglyph/Unicode confusables (e.g., `rn`→`m`, Cyrillic а/е, punycode `xn--`)
- Hyphenation variants (`example-bank`)
- TLD variants across a curated list (~50–100 relevant TLDs, not all ~1500 — cost control)
- Brand + keyword concatenations (`support`, `login`, `secure`, `verify`, `refund`, `promo`, country codes, "pay", product names from brand profile)

Then **match, don't generate-and-check-all**: ingest CT-log/NRD firehose, extract registrable domain, run it against a **precomputed Bloom filter / trie of all tenants' brand terms** for O(1)-ish candidate filtering, THEN run full Levenshtein/Jaro-Winkler/homoglyph scoring only on filtered candidates. This is the difference between a system that scales to many tenants and one that falls over — never run full string-distance against every tenant's brand list for every domain in a feed of millions/day.

Signals scored: string similarity score, homoglyph flag, brand-keyword presence, domain age, registrar, TLD risk tier, nameserver reputation, hosting ASN reputation, DNS record patterns (e.g., parked-page nameservers vs. real hosting), TLS cert issuer/age/SAN entries.

### 5.2 Website detection
Deterministic, resource-bounded checks (headless browser, e.g., Playwright, with strict timeouts, robots.txt-respecting default, and a hard concurrency/rate cap per target host — see legal/ethics note below):
- Title, meta description, visible text extraction → keyword/brand-term density
- Form detection: presence of password fields, card-number-pattern fields, PNR/booking-reference-style fields → classify login/payment/booking form
- Favicon perceptual hash vs. brand's registered favicon(s)
- Logo image hash (exact/near-duplicate, e.g. pHash) vs. brand's uploaded logo assets — MVP does exact/near-dup only, not full visual-similarity ML (see §0.3)
- Dominant color extraction vs. brand color palette (weak signal, used additively not alone)
- Technology fingerprint (server headers, JS framework signatures)
- Redirect chain capture (does it eventually land somewhere else — common phishing kit behavior)
- Contact info extraction (emails, phone numbers, WhatsApp links) for correlation, not for outreach

**Ethics/legal note**: this is read-only, robots.txt-aware, low-frequency, publicly-accessible-page fetching — equivalent to what any browser or search-engine crawler does. It must never attempt to authenticate, submit forms, brute-force, or access anything behind a login. Rate-limit per target host regardless of tenant count to avoid looking like a DoS.

### 5.3 Social & content (realistic version — see §0.2)

**Proactively monitored at MVP, via real official APIs, no ToS risk:**
- **X**: keyword search (brand terms) + username-similarity generation (same permutation logic as domains, applied to handles) via API v2 search endpoints
- **Reddit**: subreddit/keyword search via Data API
- **YouTube**: search + comment scanning via Data API v3 for scam links in descriptions/comments
- **Meta Ad Library**: keyword/advertiser search across all active + historical Facebook/Instagram ads — catches paid promotion of fake refunds/discounts/prize scams directly, with no discovery-API gap at all (Ad Library is inherently a search index, this is exactly what it's for)
- **Telegram**: monitor a **seeded list** of known/reported channels (no discovery API); analysts add channels manually or via submission

**Phase 2, real but requires per-customer setup — not MVP:**
- **Facebook/Instagram organic content**: customer grants the platform **delegated Business Manager / partner access** to their own account, then monitoring runs under Meta's **Brand Rights Protection** program against that access grant. This is proactive and Meta-sanctioned (the customer authorizes it, nothing is scraped), but each customer has to complete an onboarding/enrollment step and Meta's own approval timeline is outside our control — real capability, wrong fit for a hard MVP timeline.
- **Licensed social threat-intelligence data provider** (Recorded Future, Flashpoint, Constella Intelligence, or similar) as a build-vs-buy alternative for broader social/dark-web coverage — evaluate cost against building (above) yourself once there's revenue to justify it.

**Manual submission (MVP fallback for everything else — LinkedIn, TikTok, WhatsApp-referenced numbers, and any Meta content a customer hasn't delegated access for):** analyst or the brand's own team submits a URL/handle → platform fetches what's publicly visible for that one URL → scores and correlates it like any other finding, citing the submitter. This turns "we scan Instagram" (false promise) into "submit a suspicious profile and we'll investigate, score, and correlate it in seconds" (true, valuable, still impressive) — legally clean and cheap regardless of which of the above you also build.

**Firecrawl's actual role**: it's a page-fetch/extraction tool, not a discovery tool, so it doesn't resolve the "find every fake account" gap for any platform — it's the right tool for (a) fetching a single URL an analyst/customer has already submitted, cleanly, without hand-rolling a per-platform parser, and (b) the **open-web/content-monitoring module** (brief §6: blogs, forums, news, general scam sites), where it should be paired with a **search API** (Google Programmable Search / Bing Web Search API) that does the actual discovery — Firecrawl then extracts full content from the hits. It is explicitly **not** to be pointed at proactive crawling/searching of Facebook, Instagram, LinkedIn, or TikTok — that's the mass-automated-scraping pattern their ToS prohibit and their anti-bot systems are built to detect and block regardless of which tool sits behind it, and it conflicts with the brief's own principle of avoiding aggressive scraping (§33 of the original brief). See §0.2 for the legal nuance on logged-out public scraping (*Meta v. Bright Data*) — relevant context for a future decision, not a basis for MVP scope.

### 5.4 Cross-source correlation
Rule-based graph construction at MVP (see §7 for the graph-shaped data model), evaluated as new findings/evidence arrive:
- Two findings share IP, nameserver, registrar, ASN, or TLS cert issuer+SAN overlap → link with `infrastructure_shared` edge
- A social finding's bio/post contains a URL matching or fuzzy-matching a domain finding → link with `links_to` edge
- A domain finding's website contact info (phone/WhatsApp) matches another finding's contact info → link with `shared_contact` edge
- When a connected component of linked findings exceeds a threshold (≥2 findings across ≥2 source types, or any Critical-severity link), auto-create/attach a **Campaign** entity and boost all member findings' correlation-bonus score component
- Phase 2 upgrades this from rule-based linking to graph-analytics (community detection) + ML-assisted "does this cluster look like one actor" classification — MVP correctness matters more than MVP cleverness here.

---

## 6. Risk Scoring Model

Deterministic, additive, fully explainable — every point traceable to a named rule. No black-box ML score at MVP (AI can *narrate* the score, never *set* it).

```
score = clamp(0, 100, sum(signal_weights) + correlation_bonus - legitimacy_deductions)
```

Example signal weight table (tunable per-tenant later, global defaults at MVP):

| Signal | Weight |
|---|---|
| Domain string similarity ≥ 90% to protected brand | +30 |
| Homoglyph/punycode match | +25 |
| Domain registered < 7 days ago | +20 |
| Domain registered < 24 hours ago | +30 (supersedes above) |
| Privacy-proxy WHOIS on a brand-keyword domain | +10 |
| Website: protected logo/favicon match detected | +15 |
| Website: login form detected | +15 |
| Website: payment form detected | +15 |
| Website: booking-style form detected | +10 |
| Website: brand name density high in text | +10 |
| High-risk TLD for this brand's threat history | +10 |
| Shared infra (IP/NS/cert) with an existing Confirmed threat | +20 |
| Linked from a social finding | +15 |
| Part of a correlated campaign (≥2 findings) | +15 (campaign-level bonus, applied to all members) |
| Domain resolves to known-legitimate CDN/parking with no content | -10 |
| Domain WHOIS/registrant matches brand's own registered contact | -40 (i.e., it's probably the brand's own defensive registration) |

Bands: 0–29 Low · 30–59 Medium · 60–79 High · 80–100 Critical.

Every score change is stored as an immutable **score event** (`+15 login form detected, at 2026-09-09T02:21:00Z`) — this is what powers both the "why did this get 94?" breakdown and the timeline view. Score is recomputed (not just incremented) on every re-scan so removed signals (e.g., site taken down) can lower it too.

---

## 7. Data Model (Core Schema)

Postgres, tenant isolation via `organization_id` on every tenant-scoped table + **Row-Level Security (RLS) policies** enforced at the DB layer (not just app-layer filtering — this is non-negotiable for a security product; a query-builder bug should not be able to leak tenant B's data to tenant A).

```
organizations (id, name, industry, plan, created_at, ...)
users (id, email, name, auth_provider_id, ...)
memberships (id, org_id, user_id, role[owner|admin|analyst|viewer], invited_at, accepted_at)

brands (id, org_id, name, description, industry, country, status)
brand_domains (id, brand_id, domain, type[primary|secondary], verified_at)
brand_social_accounts (id, brand_id, platform, handle, url, verified_at)
brand_keywords (id, brand_id, keyword, type[name|abbrev|product|misspelling])
brand_assets (id, brand_id, type[logo|favicon|screenshot|guideline], storage_url, hash)
brand_colors (id, brand_id, hex, role)
brand_people (id, brand_id, name, role, official_profile_urls[])  -- optional, execs/support

findings (
  id, org_id, brand_id, type[domain|website|social|content|email(future)],
  source, platform, identifier (domain/handle/url),
  risk_score, severity[low|medium|high|critical],
  status[new|investigating|confirmed|false_positive|monitoring|reported|takedown_requested|resolved],
  assignee_id, tags[], first_detected_at, last_scanned_at, next_scan_at,
  created_at, updated_at
)

finding_evidence (id, finding_id, type, description, data(jsonb), source, created_at)
finding_score_events (id, finding_id, delta, reason, rule_code, created_at)
finding_timeline_events (id, finding_id, event_type, description, metadata(jsonb), occurred_at)
finding_notes (id, finding_id, author_id, body, created_at)
finding_activity_log (id, finding_id, actor_id, action, from_value, to_value, created_at)  -- audit trail

domain_intel (finding_id, registrar, registered_at, expires_at, nameservers[], whois_raw(jsonb),
              dns_records(jsonb), ip, asn, hosting_provider, country, tls_cert(jsonb))

website_intel (finding_id, screenshot_url, title, meta_description, extracted_text,
               technologies[], forms(jsonb), links[], redirect_chain[], scanned_at)

social_intel (finding_id, platform, username, display_name, bio, profile_image_url,
              banner_url, account_created_at, followers_count, following_count,
              links[], recent_posts(jsonb), submitted_by_user_id)

entities (id, org_id, type[ip|nameserver|registrar|certificate|asn|phone|email|contact],
          value, first_seen_at)  -- normalized shared-infrastructure nodes
finding_entity_links (finding_id, entity_id, relation)  -- graph edges, powers §11/§12 of the brief

campaigns (id, org_id, name, risk_score, status, created_at)
campaign_findings (campaign_id, finding_id, relation_note)

alert_rules (id, org_id, name, conditions(jsonb), channels[], enabled)
alert_deliveries (id, alert_rule_id, finding_id, channel, status, sent_at)

integrations (id, org_id, type[webhook|slack|teams|email], config(jsonb), enabled)

takedown_requests (id, finding_id, provider, reference, status, requested_at, resolved_at, notes)

audit_log (id, org_id, actor_id, action, resource_type, resource_id, metadata(jsonb), created_at)
```

The `entities` + `finding_entity_links` tables are the deliberate hook for the threat-intelligence graph (brief §12) — they exist from day one even though the MVP UI only renders correlation as a flat "related findings" list, not a graph visualization. This is the one place I've added structure ahead of MVP UI needs, because retrofitting graph edges onto a schema that wasn't built for them later is genuinely costly; rendering the graph later is comparatively cheap (it's a UI feature on top of existing edges).

---

## 8. API Architecture

- REST (not GraphQL) for MVP — simpler to secure, cache, and rate-limit per tenant; GraphQL adds real value only once the frontend has many divergent read-shapes, which isn't true yet.
- Every request scoped by `organization_id` derived from the authenticated session/JWT — never trust a client-supplied org ID.
- Zod schemas shared between API validation and frontend types (single source of truth) — real leverage from keeping the whole stack in TypeScript (see §15).
- Versioned from day one (`/api/v1/...`) even though there's one version — cheap now, expensive to retrofit.
- Idempotency keys on write endpoints that might be retried by workers (e.g., finding creation from a pipeline stage).
- Public customer-facing API (for their own integrations) is explicitly **Phase 3**, not MVP — internal API is not the same contract as a public API (different versioning/support obligations) and conflating them early creates lock-in debt.

---

## 9. AI Layer Architecture

Single AI service, called for narrowly-scoped tasks, always fed the deterministic score/evidence as context (never asked to invent a verdict from scratch):

1. **Threat explanation** — given a finding's evidence + score breakdown, generate a plain-English explanation. Deterministic score is ground truth; LLM narrates it.
2. **Summarization** — condense a finding or campaign for a "share with security team" export.
3. **Classification assist** — given ambiguous content (e.g., a submitted social post's text), classify as phishing/impersonation/counterfeit/legitimate-mention/spam. Output is a **suggested tag with confidence**, surfaced to the analyst, never auto-applied to status without confirmation for anything above Low severity.
4. **Campaign coherence check** — given a cluster the rule-based correlation engine proposes, ask the LLM to sanity-check "does this read as one actor" and surface its reasoning as supporting evidence, not as the correlation decision itself (the graph edges are the decision; AI is a second opinion layer).
5. **Recommended next action** — templated + LLM-refined suggestion ("report to registrar X via abuse@..., recommend takedown request, notify affected customers via Y channel").

Guardrails: every AI output is logged with the exact prompt/context sent (for auditability — a security product cannot have "the AI said so" as an unexplainable input), rate-limited per tenant, and clearly labeled in the UI as AI-generated, distinct from deterministic findings.

---

## 10. Multi-Tenant Architecture

- **Isolation**: shared database, `organization_id` on every row, enforced via Postgres RLS policies keyed to the authenticated session's org claim — defense in depth beyond app-layer `WHERE org_id = ?` filtering.
- **Roles**: Owner (billing + org settings + user management), Admin (full operational access, no billing), Analyst (manage findings/investigations, no user management), Viewer (read-only dashboard/reports).
- **Brand-scoped permissions** are a natural Phase 2 add (an analyst scoped to only one brand within a multi-brand org) — data model (`brand_id` on findings) already supports it; don't build the permission UI for it at MVP.
- **Cross-tenant shared data**: some data is legitimately global, not tenant-owned — the domain-permutation candidate matching infrastructure, the entity/infrastructure graph *could* theoretically reveal that two different tenants' brands are being targeted by the same threat actor/infrastructure. This is a genuinely valuable future signal ("this registrar/IP has hosted phishing for 3 of our other customers") but is also a **data-sharing/privacy decision**, not just an engineering one — flag to legal/product before ever surfacing cross-tenant correlation, even anonymized. Do not build this without an explicit decision.

---

## 11. Provider Abstraction Layer

```
Monitoring Engine
      |
Provider Abstraction (interfaces, not implementations, in application code)
      |
  ┌───┴────────────┬──────────────┬───────────────┬────────────────┐
DomainDiscoveryProvider   DomainIntelProvider   WebsiteScannerProvider
SocialMonitoringProvider  ThreatIntelProvider    NotificationProvider
```

Each is a TypeScript interface with one or more concrete implementations selected via config per environment/tenant-tier (e.g., cheaper WHOIS provider on Free/Starter, higher-SLA one on Enterprise). This is what lets you swap CT-log vendors or add a second WHOIS provider for redundancy without touching the discovery worker's business logic — genuinely worth the upfront interface design, unlike most "abstract everything" advice, because provider churn (pricing changes, rate-limit changes, acquisitions) in this specific space is common.

---

## 12. Provider Landscape (verify current pricing before commercial commitment — this space changes)

| Need | Realistic options | Notes |
|---|---|---|
| **Certificate Transparency (new domain discovery)** | crt.sh (free, community, rate-limited), Censys CT/search API (paid tiers), Facebook CT monitoring API (free, has usage limits), SSLMate CertSpotter | Best low-cost MVP entry point for "domain discovered within minutes of cert issuance." Combine 2 sources for coverage/redundancy. |
| **Newly Registered Domains (NRD) feeds** | WhoisXML API NRD feed, DomainTools Newly Active/Registered Domains, Farsight/DomainTools passive-DNS-adjacent feeds | Paid, priced by feed volume; genuinely useful complement to CT (catches domains before/without a cert). |
| **WHOIS / RDAP** | WhoisXML API, IPQualityScore, RDAP (free, ICANN-mandated, increasingly the standard replacing WHOIS, patchier data completeness per-registry) | Use RDAP first (free, standardizing), fall back to a paid WHOIS API for registries with weak RDAP data. |
| **DNS / Passive DNS** | Standard DNS resolution (free, self-hosted resolver), SecurityTrails, Farsight DNSDB | Passive DNS (historical) is a paid-tier nice-to-have for investigation depth, not MVP-critical. |
| **IP / hosting / ASN reputation** | IPinfo, MaxMind GeoIP/ASN, AbuseIPDB, Spamhaus | AbuseIPDB has a usable free tier; good MVP starting point. |
| **Malware/phishing URL reputation** | Google Safe Browsing API (free), VirusTotal API (free tier + paid), PhishTank (free, community) | Google Safe Browsing free tier is a strong, credible MVP signal — use it. |
| **Screenshots / headless browsing / page extraction** | Self-hosted Playwright on your own workers (cheapest, most control), or managed: **Firecrawl**, ScreenshotOne, Urlbox, Browserless | Firecrawl is a good default for MVP: less anti-bot/proxy infra to operate yourselves, clean markdown/structured extraction, screenshot support. Use it for the website-analysis worker, for fetching analyst/customer-submitted social URLs, and (paired with a search API below) for open-web content monitoring. Keep self-hosted Playwright as the fallback/upgrade path once you need signals Firecrawl doesn't expose (detailed form-field typing, full redirect-chain/JS-behavior tracing). Does **not** solve social-platform *discovery* (see §5.3) — it's a fetch tool, not a search tool, for the gated platforms. |
| **Web search (discovery for brief §6 content monitoring)** | Google Programmable Search API, Bing Web Search API, or SerpAPI (wraps either, adds convenience/reliability at a markup) | Pairs with Firecrawl: search API finds candidate pages (blogs, forums, news, scam sites) mentioning the brand + scam keywords across the indexed open web, Firecrawl extracts full content from the hits. This is normal, expected crawl territory — not a gated-platform problem. |
| **X (Twitter) API** | Official API v2, paid tiers (Basic/Pro) | Needed for real-time keyword/handle search; budget monthly cost per tenant tier. |
| **Reddit Data API** | Official, free tier + paid at volume | Fine for MVP volume. |
| **YouTube Data API v3** | Official, free quota | Fine for MVP volume. |
| **Meta Ad Library API** | Official, free, public | Real proactive MVP source for paid/promoted impersonation content on Facebook/Instagram — no discovery gap, no ToS risk. |
| **Telegram** | Bot API (public channels only, no discovery) | Seeded-channel monitoring only, as discussed in §0/§5.3. |
| **Facebook/Instagram organic content, LinkedIn, TikTok discovery** | No general commercial API path; Meta organic content is reachable via customer-delegated Business Manager access + Brand Rights Protection | Manual submission (§5.3) at MVP for all of these; Meta organic-content delegated access is Phase 2 (real, but per-customer onboarding + Meta approval latency); evaluate a licensed social-threat-intel data partner (Recorded Future, Flashpoint, Constella) as a build-vs-buy alternative once volume/budget justifies it. |

**Do not select final vendors from this document alone** — pricing, rate limits, and ToS terms change; confirm current commercial terms directly with each vendor (and get their DPA/data-processing terms reviewed) before signing.

---

## 13. Frontend Architecture & Sitemap

```
/auth                (login, signup, invite-accept, SSO placeholder)
/onboarding           (org creation, first-brand wizard)
/dashboard            (4-question overview: protected? happening? dangerous? action needed?)
/brands               (list, detail, edit — domains/keywords/assets/socials/people)
/domains              (protected domains list + discovered/suspicious domains)
/threats              (unified feed — filterable table, the brief's "threat feed")
/threats/[id]         (investigation detail — overview/domain-intel/website-intel/
                        social-intel/evidence/timeline/notes/activity)
/campaigns            (correlated campaign list + detail — flat "related findings"
                        view at MVP, graph visualization Phase 2)
/social               (submitted/monitored social accounts, submission form)
/alerts               (alert rules configuration, delivery history)
/investigations        (my assigned queue, saved filters — could merge into /threats
                        as a saved-view rather than a separate module at MVP)
/intelligence          (Phase 2+: search/reporting, exports)
/team                  (members, roles, invitations)
/integrations          (webhook config, Slack/Teams — Phase 2 for native apps)
/billing               (plan, usage, invoices — Phase 2 enforcement)
/settings              (org profile, notification preferences, API keys[Phase 3])
```

Component library organized as: primitives (Button, Badge, Table, Card) → domain components (SeverityBadge, RiskScoreDial, EvidenceCard, ThreatTimeline, IntelPanel, CorrelationList) → page compositions. Business logic (scoring interpretation, status-transition rules) lives in hooks/services consumed by components, not embedded in JSX, per the brief's explicit instruction.

State/data: TanStack Query for all server state (no client-side duplication of API data), Zod-validated API responses, dark/light mode via CSS variables from day one (cheap now, painful to retrofit into a data-dense table-heavy UI later).

Page-by-page UX highlights worth calling out:
- **Dashboard**: top strip = 4 answer-cards (protection status, new findings 24h, critical+high count, open investigations), below = severity distribution chart, threats-by-category, threats-by-platform, recent timeline feed.
- **Threat detail**: score breakdown must be a literal itemized list (+30 reason, +15 reason...) — this is the "explainable" promise made concrete in UI, not just backend data.
- **Threat feed**: dense table, severity as a colored left-border + badge (not just text, per brief's example formatting), inline quick-actions (assign, change status) without leaving the table — analysts triage dozens of rows, full-page navigation per item kills throughput.

---

## 14. Security & Compliance Architecture

- TLS everywhere, encryption at rest for the database and object storage.
- RLS-enforced tenant isolation (§10) — the single most important security control in a multi-tenant security product, since a leak here is an existential/reputational event for the vendor itself.
- Least-privilege service credentials per worker (domain worker doesn't need write access to billing tables, etc.).
- Full audit log (`audit_log` table, §7) for every state-changing action — status changes, role changes, exports, integration config changes. Security-product customers will ask for this in due diligence.
- Data retention policy configurable per tenant (how long to keep raw HTML/screenshots of scanned suspicious sites) — this is both a cost control and a privacy/legal requirement (you're storing scraped content of third-party sites, some of which may contain scraped-victim personal data if a phishing site was actively harvesting).
- Responsible-scanning posture (§5.2): respect robots.txt by default with an documented, narrow override policy for known-malicious-once-confirmed hosts, rate-limit per target host, identify your crawler with a real User-Agent and abuse-contact — this is both an ethical stance and reduces the chance your own infrastructure gets IP-blocklisted, which would break the product.
- Secrets management via a proper vault (not env files in plaintext) for the many third-party API keys this architecture accumulates.
- SOC 2 Type II should be a roadmap item (not MVP) — enterprise brand-protection buyers (banks especially) will require it before contract; plan the audit-log/access-control groundwork now so it's not a rebuild later.

---

## 15. Technology Stack

- **Frontend**: Next.js (App Router), TypeScript, React, Tailwind CSS, TanStack Query, Zod, Recharts or similar for charts.
- **API/BFF & workers**: **Node.js/TypeScript** (NestJS, or a lighter Fastify-based structure), for MVP. Reasoning, after weighing this against a Python/FastAPI backend: the frontend is already committed to TypeScript, and for a small team, one language across the whole stack — shared Zod schemas between frontend and backend, one dependency ecosystem, one hiring/skill profile — is worth more during MVP than Python's ML-library advantage, because the ML-heavy work (visual/logo similarity, embedding-based clustering) isn't an MVP requirement in the first place (see §0.3, §16 Phase 2). Use **BullMQ** (Redis-backed) for job queues at MVP scale; reach for Kafka only when volume/replay requirements actually demand it.
- **Phase 2 ML microservice**: when logo/visual-similarity and clustering-based campaign detection actually start (§16), add a **narrow, isolated Python service** (FastAPI is a fine choice *for that service specifically*) that the Node backend calls over an internal API — this captures Python's ML ecosystem (scikit-learn, imagehash, OpenCV, sentence-transformers) exactly where it's needed, without paying the two-language cost for the entire product from day one. Revisit this split only if the team's actual skill mix is more Python- than TypeScript-fluent — that's the one fact that would flip the MVP recommendation.
- **Database**: PostgreSQL (RLS for tenant isolation), Redis (queues/cache/rate-limiting). Prisma or Drizzle for the ORM/migrations layer.
- **Object storage**: S3-compatible (screenshots, raw HTML, exports).
- **Headless browser / page fetching**: two legitimate options, not mutually exclusive — see §11 for how the provider-abstraction layer picks between them: (a) self-hosted Playwright for full control over form-field detection, redirect-chain capture, and JS-behavior signals; (b) **Firecrawl** as a managed alternative where you'd rather not operate anti-bot/proxy infrastructure yourself — its strongest fit is the website-analysis worker, the manual social-URL-submission flow, and (paired with a search API, see §12) the open-web/content-monitoring module (brief §6: blogs, forums, news, scam sites) — not proactive crawling of gated social platforms (§5.3). Keep self-hosted Playwright as the fallback for signals Firecrawl doesn't expose.
- **Search** (Phase 2): OpenSearch/Elasticsearch for full-text threat-feed search once volume justifies it over Postgres full-text.
- **AI**: Claude via the Messages API, server-side only (never expose provider keys to frontend), with prompt/response logging for auditability (§9).
- **Infra**: containerized (Docker), deployable to any major cloud; avoid deep proprietary lock-in at MVP so you're not stuck if a specific cloud's pricing doesn't work for a data-heavy workload like this.

---

## 16. Roadmap

**MVP (target ~10–14 weeks for a small focused team, 3–5 engineers)**
Everything in §2 "In scope." Suggested internal sequencing:
1. Weeks 1–2: auth, multi-tenancy skeleton, org/brand onboarding, DB schema + RLS
2. Weeks 3–5: domain discovery pipeline (CT + one NRD feed), matching engine, WHOIS/DNS/IP enrichment, risk scoring v1
3. Weeks 5–7: website analysis worker, risk scoring v2, threat feed + dashboard UI
4. Weeks 7–9: investigation detail page, evidence/timeline, lifecycle/status/notes
5. Weeks 8–10: X + Meta Ad Library API integrations, manual social submission flow, correlation engine v1
6. Weeks 10–12: alerting (email/in-app/webhook), AI explanation/summarization layer
7. Weeks 12–14: takedown-tracking workflow, polish, security hardening pass, design-partner pilot

**Phase 2** (post-MVP validation): Meta Business Manager delegated access + Brand Rights Protection integration for organic Facebook/Instagram monitoring, evaluation of licensed social-threat-intel data partners (FB/IG/LinkedIn coverage), search-API + Firecrawl open-web/content monitoring (brief §6), isolated Python ML microservice for logo/visual-similarity + embedding-based campaign clustering, threat-intelligence graph visualization, infrastructure clustering at scale, native Slack/Teams apps, real webhooks-as-a-feature (customer-configurable event types), additional threat-intel provider integrations, billing enforcement.

**Phase 3**: email/domain impersonation monitoring module, executive/employee impersonation monitoring, automated takedown-provider integrations, SSO, public customer API, SIEM/SOAR integrations, predictive/ML-driven prioritization, SOC 2 certification.

---

## 17. Risks

**Technical**
- Domain-matching false-positive rate at scale (common words as brand keywords generate noise) — mitigate with tunable per-brand keyword confidence and an easy false-positive feedback loop that should influence future scoring (not just dismiss-and-forget).
- Headless-browser scanning getting IP-blocklisted by hosting providers/CDNs if not rate-limited and well-identified.
- Provider dependency/cost risk: CT/NRD/WHOIS/social API pricing and rate limits can change or vendors can be acquired/shut down (this literally happened in this space — Bolster's acquisition, various WHOIS-privacy-driven data degradation post-GDPR). The provider abstraction layer (§11) is the direct mitigation.

**Legal / data-access**
- Social platform ToS violation risk if scope creeps toward scraping instead of official APIs/manual submission/customer-delegated access — this is the highest-severity legal risk in the whole brief and the reason §0.2/§5.3 are written so bluntly. Note the risk picture isn't uniform: *Meta v. Bright Data* (Jan 2024) trended favorable for logged-out public-data scraping specifically, but that's one district-court ruling, doesn't extend to LinkedIn/TikTok, and doesn't stop platforms from technically blocking scrapers regardless of the legal theory — don't treat it as settled, revisit with counsel before Phase 2 decisions lean on it.
- Scanning suspicious sites may incidentally capture real victims' data if a phishing kit is actively harvesting credentials at scan time — retention policy and access controls (§14) need to treat this as sensitive data, and legal counsel should review the scanning/retention policy, not just engineering.
- Cross-border data residency requirements for some target verticals (banks, government) may require regional data storage — worth confirming with early enterprise prospects before assuming a single-region deployment is fine.

**Product**
- Competing against funded incumbents (§0.1) — differentiation and GTM focus matter as much as feature completeness.
- Overpromising "we monitor all social media" and under-delivering will damage trust fast in a trust-selling category; the honest MVP framing in §2 is a product-risk mitigation, not just an engineering convenience.
- Alert fatigue if scoring/correlation isn't tuned — a security product that cries wolf gets its alerts muted, which defeats the entire value proposition.

---

## 18. Complexity Estimates (relative, for planning — not calendar commitments)

| Component | Relative complexity |
|---|---|
| Auth + multi-tenancy + RBAC | Medium |
| Brand onboarding UI/data model | Low–Medium |
| Domain discovery + matching engine (scalable, Bloom-filter-based) | Medium–High |
| Domain intelligence enrichment (WHOIS/DNS/IP/cert) | Medium (mostly integration work) |
| Website analysis worker (Playwright pipeline) | Medium–High |
| Risk scoring engine | Medium (logic-heavy, needs careful tuning + tests) |
| Correlation engine (rule-based, MVP) | Medium |
| Threat feed + dashboard UI | Medium |
| Investigation detail + timeline + evidence UI | Medium |
| X/Reddit/YouTube/Meta Ad Library API integrations | Low–Medium each |
| Manual social submission flow | Low |
| Search-API + Firecrawl open-web/content monitoring (brief §6) | Medium |
| Alerting engine (rules + email/webhook delivery) | Medium |
| AI layer (explanation/summarization/classification) | Medium |
| Takedown-tracking workflow | Low |
| **Phase 2**: Meta delegated-access + Brand Rights Protection integration | Medium–High (per-customer OAuth/onboarding flow, dependent on Meta's approval process) |
| **Phase 2**: graph visualization | High |
| **Phase 2**: isolated Python ML microservice (visual/logo similarity) | High |
| **Phase 2**: campaign auto-clustering | High |
| **Phase 3**: email impersonation module | Medium–High (new data sources entirely) |
| **Phase 3**: SSO/SIEM/SOAR/public API | Medium each, but many of them — cumulative High |

---

## 19. Open Decisions I Need From You Before Implementation

1. **Positioning/wedge** (§0.1, §1.3): which vertical(s) and region(s) to focus GTM on first — this affects which social platforms and providers matter most on day one.
2. **Product name** — pick one to start reserving domain/trademark, or tell me to workshop more.
3. **Social monitoring honesty framing** (§0.2, §5.3) — confirm you're comfortable launching with manual-submission + X/Reddit/YouTube/Meta-Ad-Library proactive monitoring, and marketing it as such, rather than delaying MVP to chase Meta Business Manager delegated-access integration or a licensed data partner first.
4. **Cross-tenant correlation** (§10) — explicitly defer this decision; don't let it get built by default.
5. **Infra choice** — any existing cloud/vendor commitments (AWS/GCP/Azure, existing Anthropic/OpenAI contracts, existing Postgres hosting preference) I should design around rather than assume greenfield?
6. **Team size/timeline** — the MVP estimate above assumes 3–5 engineers; tell me your real constraint so I can re-cut scope if needed.
7. **Team language skew (§15)** — the stack defaults to a TypeScript backend (Node) for MVP, splitting out an isolated Python service later just for ML work; tell me if your actual/planned team is more Python-fluent than TS-fluent, since that's the one fact that would flip this recommendation to a full Python/FastAPI backend.

---

**I have not written any implementation code.** Once you've reviewed this and either approved it or told me what to change, I'll turn the approved MVP scope into an implementation plan (repo structure, first migrations, first services) before writing code.
