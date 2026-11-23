# Brand Monitor

Brand Monitor finds people impersonating a brand online and helps you take them down. It looks
for lookalike domains, clone sites, fake social media accounts, fake apps, fake customer-care
numbers and recruitment-fee scams. It scores each one with rules you can trace, alerts the team
when something matters, and prepares the takedown reports.

It's a multi-tenant SaaS with its own invite-only sign-in, and Postgres row-level security keeps
every organization's data apart. The live test brand is Jambojet (`jambojet.com`).

| Doc | What's in it |
|---|---|
| `README.md` (this file) | How it works, every feature, local setup |
| `DEPLOYMENT.md` | Hosting (Vercel + Dokploy VPS), environment, operations, incidents |
| `ARCHITECTURE.md` | "As built" summary at the top, then the original design (partly outdated) |
| `ROADMAP.md` | Detection gaps compared with enterprise tools, and the phased plan to close them |
| `CLAUDE.md` | Working notes and conventions for AI-assisted development |

---

## How it works

```
 FINDING SOURCES                              PER-FINDING LOOP                     OUTPUT
 ───────────────                              ────────────────                     ──────
 Domain discovery (typos, keywords)  ─┐
 Certificate Transparency (LE logs)   │                                       ┌─> Alerts: email,
 Newly-registered-domain feed         │       ┌──────────────────────────┐    │   in-app, webhook
 Phishing feed (phishunt.io)          ├──────>│ Finding (domain/url/     │    │
 App Store + Google Play              │       │ social), status "new"    │    ├─> Threat feed and
 Social search (Tavily)               │       └────────────┬─────────────┘    │   finding page
 Web search (Tavily)                  │                    v                  │
 Manual submission                    │       ┌──────────────────────────┐    ├─> Takedown kit +
 Public scam-report form             ─┘       │ Recheck job (scheduled)  │────┤   tracker
                                              │  RDAP/WHOIS, DNS, IP host│    │
                                              │  page scan + screenshot  │    └─> Post-takedown
                                              │  contacts/payment details│        watch
                                              │  visual + favicon match  │
                                              │  deterministic score     │
                                              └──────────────────────────┘
```

1. **Sources create findings.** Each source (below) creates a bare, unscored *finding* when it
   sees something new. A finding has a `type` (`domain`, `url` or `social`) and a free-text
   `source` (`discovery`, `ct_log`, `nrd`, `nrd_hagezi`, `isc_recent`, `phish_feed`, `app_store`, `google_play`,
   `social_search`, `web_search`, `manual`, `public_report`).
2. **The recheck job enriches and scores it.** Every 5 minutes a dispatcher picks up findings
   that are due and runs `pipeline/recheckJob.ts` on each: registry lookup, DNS, hosting
   provider, a headless browser scan with screenshot, contact/payment extraction, favicon and
   visual matching, then a rule-based score. The first real score usually lands within minutes.
3. **Rechecks repeat on a cadence.** A finding is rechecked every 20 minutes in its first 3 days,
   every 2 hours until day 7, then daily. Dormant domains (parked or "not deployed yet") stay at
   hourly at most, so the moment one goes live is caught. False positives stop being rechecked;
   resolved findings don't (post-takedown watch).
4. **Changes fire alerts.** After each recheck, `queue/alertDispatch.ts` compares the result with
   the org's alert rules and sends email, in-app and webhook alerts.
5. **Analysts triage and take down.** The web app shows a triage-first overview, the threat feed
   and a finding page with the evidence, the takedown kit and the tracker.

The score is deterministic: every point comes from a named rule, shown as "why this score". The
AI only *explains* a score after the fact and never sets one.

### Background jobs

Jobs run on pg-boss (a Postgres-backed queue) inside the API process. The schedules are
registered in `apps/api/src/queue/dispatch.ts` and the queues are declared in `queue/boss.ts`.

| Job | Schedule | Scope | Code |
|---|---|---|---|
| Domain discovery | every 4h, or on demand | per brand | `pipeline/discoveryJob.ts` |
| Recheck (enrich + score) | dispatcher every 5 min, then per finding cadence | per finding | `pipeline/recheckJob.ts` |
| CT log monitor (names tiles) | every 5 min | global | `pipeline/ctMonitorJob.ts` |
| App Store + Google Play | every 4h | per brand | `pipeline/appStoreMonitorJob.ts` |
| Newly-registered domains (whoisds and SANS ISC every 6h, hagezi once a day) | every 6h | global | `pipeline/nrdMonitorJob.ts` |
| Phishing feed | hourly | global | `pipeline/phishFeedMonitorJob.ts` |
| Social + web search | daily (or on demand, 3/org/day) | global | `pipeline/socialSearchMonitorJob.ts` |
| Fact-check search | weekly | global | same job, separate schedule |

`GET /health/jobs` reports when each job and each source last succeeded and flags stale ones.
UptimeRobot watches it in production.

---

## Features

### 1. Finding sources

**Domain discovery** (`pipeline/permutations.ts`, `discoveryJob.ts`). Generates candidate domains
and keeps the registered ones (DNS check):
- typos and homoglyphs of the brand name (`jarnbojet.com`, `jambojеt.com` with a Cyrillic `е`)
- the exact brand name on other TLDs (`jambojet.site`)
- brand + keyword compounds in 4 arrangements (`bookjambojet.com`, `jambojet-booking.xyz`)
- keyword-brand-keyword for every pair of keywords, high-risk TLDs only (`flyjambojetkenya.store`)
- **paired keywords**: keywords marked "paired" (`concat_term_core`, max 8 per brand) are also
  combined with each other around the brand (`flybookjambojet.xyz`). 6 paired keywords add about
  1,440 candidates (~6k DNS queries) per run, so keep the list to words attackers actually use.

The brand's own allowlisted domains are always excluded. Keywords are edited under
**Settings → Brand**.

**Certificate Transparency** (`lib/ctNamesTiles.ts`, `pipeline/ctMonitorJob.ts`, since
2026-11-21). Every 5 minutes, reads every certificate name newly logged to the CT logs that
publish *names tiles* (a names-only copy of each 256-entry tile, ~24 bytes per entry) and flags
hostnames containing the brand name or a misspelling (same matcher as the new-domain feeds),
source `ct_log`. A certificate is usually logged before a phishing site goes live, so this is the
fastest domain source, and it also catches lookalike subdomains on platforms that issue per-site
certificates. Which logs: `CT_LOG_OPERATORS` (default Let's Encrypt = Sycamore + Willow, all
current shards; measured ~0.7 GB/day and ~60 s per run from Nairobi; Let's Encrypt saw ~70% of
all newly logged names in a sample). `all` adds every operator that serves names tiles (Geomys,
IPng, Microsec, GoDaddy, HARICA; ~3 GB/day, ~84%). Google, Sectigo and the older RFC 6962 logs
don't serve names tiles and aren't read. Progress per log is kept in `ct_log_cursors`, so a
failed or slow run resumes where it stopped; a new log starts at its current end, and a backlog
over 20,000 tiles (a long outage) is skipped. Failures are logged as `[ct-tiles] …` and
`ct_log` goes stale on `/health/jobs` after 1h without any log answering. This replaced the
crt.sh search, which was down far more often than up.

**Newly-registered-domain feed** (`lib/nrdFeed.ts`). Every 6 hours, downloads whoisds.com's free
daily list of new registrations and flags any domain containing the brand name or one of its
misspellings (≥6 characters). Any TLD, no certificate needed. **It's a sample**: the free list
is capped at 70,000 domains a day, so it misses most registrations.

**hagezi/nrd list** (`lib/hageziNrd.ts`, same job, since 2026-11-21). Once a day after hagezi's
08:00 UTC rebuild, streams its free list of every domain registered in the last 7 days (~3M
names, ~48 MB, ~390k a day across ~890 TLDs including `.ke`; built from Stamus Labs' feed) and
matches it the same way, source `nrd_hagezi`. On its first run it found `flyjambojetdeals.online`
and `jambojetonlinebooking.site`. It's one maintainer's project and Stamus warns of lags of a
few days, so whoisds stays on as well. A download failure or a suspiciously short file (under
100k lines) is logged as `[nrd-hagezi] … failed` and the source goes stale on `/health/jobs`
after 48h. Commercial-use terms of the underlying Stamus data aren't stated.

**SANS ISC recent domains** (`lib/iscRecentDomains.ts`, same job, since 2026-11-21). The SANS
Internet Storm Center publishes every domain it first saw the previous day, compiled from CT
logs and ICANN zone files (~335k a day, gTLDs only, so no `.co.ke`), as one ~3 MB gzipped file
refreshed hourly. Read every run and matched the same way, source `isc_recent`. Because part of
it comes from CT, it overlaps with the CT monitor but also covers certificates in Google and Sectigo logs. Set `ISC_CONTACT` so ISC can identify our
client in the User-Agent, as it asks. Terms: an ISC diary (2025-11-05) allows commercial use
with attribution and no resale, but the API page links a non-commercial licence, so this is
still to be confirmed with ISC. Data courtesy of the SANS Internet Storm Center.

**Phishing feed** (`lib/phishFeed.ts`). Every hour, downloads phishunt.io's public feed of active
phishing URLs (CC0, ~800 URLs, aggregating OpenPhish, PhishTank, urlscan, Google Safe Browsing
and TweetFeed). Matches the brand anywhere in the URL, host *or path*, so phishing on shared
hosting (`*.pages.dev`, `sites.google.com/...`) is caught. Other free feeds were ruled out on
2026-10-19 (commercial-use bans, closed sign-ups, wrong content).

**App Store and Google Play** (`lib/appStoreSearch.ts`, `lib/googlePlaySearch.ts`). Every 4 hours,
searches Apple's iTunes Search API and Google Play's Kenya store. Flags apps whose title or
publisher resembles the brand (one-letter typos and digit look-alikes count) and that aren't on
the brand's official list. Google Play has no search API, so it uses the unofficial
`google-play-scraper` package. That sits outside Google's terms and breaks when Google changes its
pages; failures show as a stale `google_play` source on `/health/jobs`. Official apps are added
as store links under **Settings → Brand → Official accounts and apps**.

**Social accounts** (`pipeline/socialFindings.ts`, needs `TAVILY_API_KEY`). Once a day, web
searches through Tavily restricted to Facebook, Instagram, TikTok, X, Telegram and YouTube:
- 4 brand searches (one in Swahili: "tiketi ofa bei nafuu")
- 2 searches for contact numbers already found on the brand's high/critical findings, rotating
  through them, so a scam number found on a clone site leads to the social accounts using it

A result becomes a `social` finding only if it isn't an official account and either the handle
or display name looks like the brand (`@fly.jambojet`, `jambotjet01235`, "Jambo Jet Airline"),
or the post gives a phone/WhatsApp/M-Pesa number that isn't the brand's, or it asks job
applicants for a fee. The finding is the **account** (canonical profile URL,
`lib/socialUrls.ts`). The post, title and snippet are stored as evidence. A post with no
identifiable account is kept as its own finding when it names the brand and shows a foreign
number. **Social findings are never scanned**: platforms block automated access and forbid
scraping, so rechecks re-score the stored evidence without touching the network.

**Web search** (`pipeline/webSearchFindings.ts`, same daily job). 3 Tavily searches of the whole
web (excluding the brand's own domains) for scam *content* rather than lookalike names:
`"<brand> customer care number"`, `<brand> recruitment cabin crew jobs` and a booking pitch. A
non-social hit becomes a finding (then scanned and scored like any URL) only when it names the
brand **and** shows a foreign number, or its site name resembles the brand (including free
builders such as `sites.google.com/view/...`), or it asks applicants for a fee. Everything else
is dropped. A clone on an unrelated name whose search snippet shows none of these is still
missed.

**Search budget.** Tavily's free plan gives 1,000 searches a month with no card. One brand uses
about 276 a month. `TAVILY_MONTHLY_CAP` (default 900) stops searching before the free allowance
runs out; usage shows on `/health/jobs`.

**Manual submission.** "Add a suspicious link" on the Overview page. A bare domain gets full
domain enrichment. A URL with a path (a specific profile or page) is scanned and scored as that
exact page without domain checks, since registration facts about someone else's platform say
nothing about one fake page on it. A social link becomes a social finding. All stay on the normal
recheck cadence.

**Public scam reports** (`routes/publicReports.ts`, `/report/<token>`). Owners and admins create
a per-brand public link (rotate or turn off anytime) to share with customers. The form takes a
link and/or a phone/WhatsApp number plus a description, with no login.
- A link becomes a finding (source `public_report`) and is scanned, max 30 report-triggered scans
  per brand per day. `wa.me` links, non-channel `t.me` links and the brand's own site are never
  scanned.
- Numbers, and any numbers in the description, are matched against contact details already found
  on findings, so "they called me from 0712…" links to the clone sites using that number.
- Each report raises an in-app notification, and the finding page lists its reports.
- Spam protection: Cloudflare Turnstile when configured, a honeypot field and 5 reports/hour per
  IP. Only what the reporter typed and an optional email are stored, no IP or device data.
- This is the only unauthenticated write route.

### 2. What each recheck collects

**Registration intelligence** (`lib/rdap.ts`, `lib/whois.ts`). Registrar, created / last-changed
/ expiry dates, EPP status codes (`clientHold` shows as "Suspended at registry") and the
registrar's abuse contact, over RDAP with WHOIS as fallback. The hosting provider and its abuse
contact come from IP RDAP, re-queried only when the IP changes. `.co.ke` and similar ccTLDs often
return nothing; the finding is still created, just without an age signal.

**Registration & site history** (`pipeline/registrationChanges.ts`). Changes between scans
(registrar, nameservers, last-changed date, status, expiry, IP) are kept on the finding page.
Registrar, nameserver, last-changed and status changes fire a `registration_changed` alert. This
catches a dormant domain being re-armed before its website comes back.

**Website scan** (`apps/scanner`, Playwright in Docker). Loads the page in headless Chromium,
takes a screenshot and detects login and payment forms and parked pages. It also returns link
targets, up to 50k characters of text and contact links found only in the site's own JavaScript
(`scriptLinks.ts`), such as a WhatsApp link a fake booking flow opens on "Book Now". The saved
screenshot gets a drawn address bar with the final URL and the capture time in UTC
(`lib/addressBar.ts`), so it stands as evidence.

**Contact & payment details** (`lib/indicators.ts`). Extracts phone numbers (Kenyan numbers
normalized to `+254…`), WhatsApp links, M-Pesa paybill/till numbers, emails, Telegram handles and
crypto wallets. The brand's own contacts (read from its homepage, cached 45 days) and emails at
its own domains are ignored. **A value shared by two findings links them**: the finding page
lists every other finding using the same number, which is the strongest "same operation" signal.
Known gap: jambojet.com serves the scanner a blank page, so Jambojet's own numbers aren't captured
yet (retried every 6h).

**Brand matching** (`lib/favicon.ts`, `lib/visualSimilarity.ts`). Compares the favicon hash with
the brand's, and a regional perceptual hash of the screenshot with the brand's real site (the
"visual reference" under **Settings → Brand**).

**Campaign correlation** (`pipeline/correlation.ts`). Groups findings registered at the same
registrar within 7 days, per brand.

### 3. Scoring

Additive and deterministic (`pipeline/scoring.ts`). Severity comes from the total:
**low** < 30 ≤ **medium** < 60 ≤ **high** < 80 ≤ **critical**. The finding page shows the
breakdown from the latest scan; older scans are kept underneath but not shown.

| Rule | Points | When |
|---|---|---|
| `PHISH_FEED_LISTED` | +60 | Listed by public phishing feeds (worded "reported", not "confirmed") |
| `APP_STORE_IMPERSONATION` | +60 | App name/publisher resembles the brand and it isn't an official app |
| `SOCIAL_HANDLE_IMPERSONATION` | +40 | Social account name resembles the brand, not an official account |
| `DOMAIN_SIMILARITY_HIGH` | +30 | Brand name verbatim plus keywords, or ≥85% similar |
| `DOMAIN_AGE_LT_24H` / `_7D` / `_30D` | +30 / +20 / +10 | Domain registered recently |
| `SOCIAL_CONTACT_DETAILS` | +30 | Social post gives a number that isn't the brand's |
| `RECRUITMENT_FEE` | +30 | Names the brand, offers jobs and asks applicants for a fee (`lib/recruitmentScam.ts`, English and Swahili) |
| `HOMOGLYPH_MATCH` | +25 | Confusable characters imitate the brand |
| `BRAND_NAME_ON_PAGE` | +25 | Page title or text uses the brand's name (catches redesigned clones) |
| `PUBLIC_REPORT` | +15 / +25 | Reported by 1–2 / 3+ members of the public |
| `SHARED_INDICATOR` | +20 | Shares a number, wallet or email with another finding |
| `DOMAIN_SIMILARITY_MEDIUM` | +15 | 60–85% similar to the brand |
| `FAVICON_MATCH` | +15 | Same favicon as the brand |
| `PAYMENT_DESTINATION` | +15 | Names the brand and asks for payment to an M-Pesa number or wallet |
| `LOGIN_FORM_DETECTED` | +15 | Login form on the page |
| `PAYMENT_FORM_DETECTED` | +15 | Payment form or language on the page |
| `VISUAL_SIMILARITY_MATCH` | +10 | Screenshot resembles the brand's real site |
| `HIGH_RISK_TLD` | +10 | TLD with elevated abuse history |
| `PARKING_PAGE_DEDUCTION` | −10 | Parked or for-sale page |
| `OWN_DOMAIN_DEDUCTION` | −40 | One of the brand's own domains |

Social findings use the two social rules in place of the domain-name rules.

### 4. Alerts

Every org gets five rules on creation. Owners and admins edit them under **Settings → Alerts**:
on/off, channels and threshold, one rule per kind (`routes/alertRules.ts`).

| Kind | Fires when | Default |
|---|---|---|
| `severity_threshold` | A finding's severity crosses into the threshold | on, high |
| `website_activated` | A dormant domain starts serving real content (once per finding) | on |
| `registration_changed` | Registrar, nameservers, status or last-changed date change | on |
| `site_reactivated` | A taken-down site comes back | on |
| `public_report` | Someone submits the public report form (in-app only) | on |
| `new_finding` | Any new finding at or above a severity | off, created when first enabled |
| `score_increase` | Score jumps by at least N points | off, created when first enabled |

**Channels:**
- **In-app**: the bell icon and `/notifications`.
- **Email**: plain SMTP to every member.
- **Webhook**: configured under **Settings → Integrations**. HTTPS to a public host only, signed
  with a secret (shown to owners and admins, can be rotated), with a "send test" button.

The parked-page detector sometimes misreads one scan of a live site, so alerts are debounced:
`website_activated` fires only once per finding, and "down" needs two consecutive scans.

### 5. Triage and investigation

- **Lifecycle**: `new → investigating → confirmed / false_positive → resolved`, plus an
  assignee, tags and a threaded notes log on the finding page. Bulk actions on the threat feed.
- **AI explanation** (`lib/aiExplain.ts`): "Generate AI explanation" asks an LLM to explain the
  score and evidence in plain English. Any OpenAI-compatible API works; the default is Google
  Gemini's free tier, with `AI_MODEL` as a fallback chain. Cached per scan and capped at
  `AI_EXPLANATION_DAILY_LIMIT` per org per day (default 100).
- **Related findings**: the same contact details or the same registration campaign.
- **CSV export**: every finding matching the current filters and sort (max 5,000), with
  registrar, IP, hosting org, assignee and a link back. Cells starting with `= + - @` are escaped
  so attacker-chosen URLs can't run as spreadsheet formulas.

### 6. Takedowns

- **Takedown kit** (`lib/takedownKit.ts`): every reporting channel that applies to the finding,
  each with a ready-to-send message built from the evidence (URL, registration, host, score
  reasons, numbers, screenshot link). Channels: registrar abuse email (asking for `clientHold`;
  ICANN Lookup when the registry gave no contact), hosting provider (Vercel/Cloudflare web forms
  or the host's abuse email), Google Safe Browsing, Safaricom 333 SMS for Kenyan numbers,
  WhatsApp in-app report per number, KE-CIRT/CC, and the platform's impersonation form for
  social findings. **Nothing is sent automatically**; the analyst sends each one.
- **Tracker**: log each request (provider, ticket reference, notes) with its own status
  (`requested → acknowledged → completed / rejected`). "Mark as reported" in the kit logs a row
  per channel, so you can see which channels actually work. A warning shows when a takedown is
  marked completed but the site is still live: content removal without a registrar suspension
  leaves the domain with the attacker.
- **Post-takedown watch** (`pipeline/takedownWatch.ts`): resolved and taken-down findings keep
  being rechecked. Once two consecutive scans show the site down (no DNS, parked, or HTTP
  404/410/451), seeing live content again fires `site_reactivated`, logs it in the history and
  moves a resolved finding back to `new`. Prompted by `flyjambojet.org`, which was taken down in
  September 2026 and came back in October.

### 7. Brand awareness

- **Mentions feed** (`/mentions`, `pipeline/brandMentions.ts`): social posts from the same
  searches that name the brand but aren't threats (news, complaints, promotions, chatter). No
  extra search credits. One AI call after each run labels up to 25 new mentions with a category
  and sentiment. Every stored mention is re-checked against the current threat rules each run,
  and one that now counts as a threat moves to the threat feed. It's a sample (~30–40 posts a
  run), not full social listening.
- **Fact-checks**: once a week, one search per brand on pesacheck.org. A new article about the
  brand raises an in-app notification (no finding; the article isn't the threat).

### 8. Web app

| Page | What it shows |
|---|---|
| **Overview** (`/dashboard`) | Open threats by severity, new this week, a **Needs attention** list (open high/critical, untriaged first), takedowns in progress, source health, recent activity. Buttons: Run discovery, Search social & web, Add a suspicious link. |
| **Threats** (`/threats`) | The threat feed. Open findings by default ("All" shows everything), filters, sorting, paging, bulk actions, CSV export. Targets shown by name (`@handle` + platform, app id, host + path). |
| **Finding page** (`/threats/[id]`) | Left: evidence (screenshot or social post, score breakdown, AI explanation, contacts, reports, related findings). Right: triage, takedown kit and tracker, domain details and history. |
| **Mentions** (`/mentions`) | Non-threat brand mentions with 7-day counts and filters. |
| **Reports** (`/reports`) | Public scam reports and the per-brand report link. |
| **Notifications** (`/notifications`) | In-app alerts. |
| **Settings** (`/settings?section=<id>`) | Sidebar, one setting at a time (dropdown on phones). **Brand**: details and domains, keywords with the paired switch, official accounts and apps, report link, visual reference, add/delete brand. **Alerts**, **Integrations** (webhook), **Team**. |
| **Public report form** (`/report/<token>`) | No login. |

Every page has a skeleton loading state, and a thin progress bar shows navigation in flight. The
selected brand is remembered per browser.

### 9. Accounts, roles and tenancy

- **Sign-in** is our own (no auth provider since 2026-11): email + password, invite-only. Owners
  and admins invite people by email under **Settings → Team**, choosing their role (only owners
  invite owners); the invite link lasts 7 days, and the new person sets a password on accepting.
  "Forgot password" emails a 1-hour reset link. Only platform admins create organizations (see
  below). The very first account is created from the CLI (`npm run auth:create-user`, see Local
  setup).
- **Platform admin panel** (`/admin`, "Admin panel" in the avatar menu; `routes/admin.ts`): for
  `users.platform_role = 'admin'`, set only with `npm run auth:make-admin -- --email <email>`
  (`--revoke` to remove), never through the API. The panel also requires 2FA on the account. It
  lists every organization (members, brands, findings, this month's scans and alert emails, last
  member activity) and every user (orgs, sign-in methods, 2FA, last activity), shows the month's
  Tavily usage, creates organizations (without joining them) and invites their first owner. Every
  admin action goes to `admin_audit_log`, shown on the Audit log tab. A `superadmin` role that can
  make admins from the panel is planned. Next steps: pause/resume monitoring, user actions, delete
  org, and a read-only view into any org (`ADMIN_PLAN.md`).
- **Account and security** (`/account`, from the avatar menu): name; password change (needs the
  current one, signs out every other device, emails a notice); email change (needs the current
  password, confirmed through a 1-hour link sent to the new address, notice to the old one); and
  the list of signed-in devices with "sign out" per device or everywhere else.
- **Two-factor sign-in** (optional, per user, on the account page): an authenticator app
  (TOTP, RFC 6238: 6 digits, 30 s, ±1 step) plus 10 single-use recovery codes, shown once and
  stored only as hashes. With it on, the password step returns a 5-minute challenge instead of a
  session; 5 tries per challenge; a used code's time step is recorded so it can't be replayed.
  The TOTP secret is stored AES-256-GCM-encrypted with `AUTH_ENCRYPTION_KEY`. Turning it on signs
  out other devices; turning it off needs the password and a code (or a recovery code). A user who
  lost both phone and codes is reset with `npm run auth:disable-2fa -- --email <email>`.
- **Sign in with Google** (optional, shown only when `GOOGLE_CLIENT_ID`/`SECRET` are set;
  `routes/google.ts`): OpenID Connect code flow with PKCE, a nonce, and a single-use state tied to
  the browser by a short-lived `bm_oauth` cookie (blocks login CSRF). Still invite-only: Google
  signs in an existing account (matched by Google's user id, or on first use by its verified email,
  which then links it), or accepts an invite when the Google email is the invited one; an unknown
  Google account is refused. 2FA, if on, still asks for the code. Users can link or unlink Google
  on the account page; unlinking needs a password to fall back on.
- **How it works** (`apps/api/src/auth/`): passwords hashed with scrypt; the session is a random
  token in an HttpOnly, SameSite=Lax cookie (`bm_session`, 30 days, 7 days idle), stored only as a
  SHA-256 hash in `sessions`, which also holds the active organization. Reset and invite links are
  single-use hashed tokens in `auth_tokens`. These tables and `user_auth` (credentials) have no RLS
  and the app role has no grants on them; only the auth code reads them, via `adminPrisma`. Every
  state-changing request that carries the cookie must come from `WEB_APP_URL` (Origin check in
  `server.ts`), since SameSite treats sibling subdomains as same-site. Login is limited to 10
  tries per email and 30 per IP per 15 minutes; a reset or password change signs out everywhere.
- **Roles** (`owner`, `admin`, `analyst`, `viewer`) live in the `memberships` table. Owners
  change roles and remove members under **Settings → Team**, never their own, and the last owner
  can't be demoted or removed. Only owners and admins can change settings; others see them
  read-only.
- **Tenancy**: Postgres row-level security. Every request and pipeline query runs through
  `withTenant(orgId, fn)` (`lib/tenant.ts`) as the restricted `brandmonitor_app` role.
  `adminPrisma` is used only for auth (before any org context exists) and cross-tenant job
  dispatch.
- **Rate limits** (`lib/rateLimit.ts`): per IP 300 requests/min and 60 screenshots/min; per org 12
  manual discovery runs, 50 manual submissions and 3 social searches a day. In memory, so they
  reset on restart.
- **CORS** is locked to `WEB_APP_URL` (plus localhost in development).

All data queried is public (DNS, RDAP/WHOIS, public web pages, search results). If a run surfaces
a genuinely live phishing site, report it responsibly to the brand's security team.

---

## Local setup

### Prerequisites

- Node.js 20+ and npm
- Docker Desktop (runs Postgres on port 5450 and the Playwright scanner)

### Steps

```bash
# 1. Install. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD keeps Chromium off your machine:
#    the scanner runs Playwright inside Docker.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install

# 2. Start Postgres and the scanner (the first run downloads a few GB of images)
docker compose up -d --build

# 3. Configure (see the comments in each example file)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local

# 4. Create the schema, the restricted brandmonitor_app role and its RLS policies
npm run prisma:migrate

# 5. Once per environment: create pg-boss's schema and grant brandmonitor_app access to it.
#    Re-run only after a pg-boss upgrade that changes its schema.
npm run queue:bootstrap -w @brand-monitor/api

# 6. Optional demo brand (org id seed-org-jambojet)
npm run prisma:seed

# 7. Your first account. Prints a one-time link to set the password (add --send-email to email it).
npm run auth:create-user -w @brand-monitor/api -- --email you@example.com --org seed-org-jambojet
#    or, without the seed:  ... -- --email you@example.com --new-org "My Org"
```

### Run

```bash
npm run dev:api   # http://localhost:4000, also starts the job queue and workers
npm run dev:web   # http://localhost:3000
```

Open the link from step 7, set a password, sign in, then open `/dashboard`. With no brand yet, a
short form creates one. Click **Run discovery** for an immediate pass, or wait for the background
jobs. Open the web app and the API on the same host name (both `localhost`), or the sign-in
cookie isn't seen.

> **Warning:** `npm run dev:api` runs the real recheck dispatcher, which sends real alert emails
> and scans real third-party sites. Don't leave it running. Stopping the terminal task may leave
> the node process alive: find it with `netstat -ano | grep :4000` and kill it. To work on the
> UI or sign-in without any of that, start the API with `DISABLE_SCHEDULERS=1` (no queue workers
> or dispatchers; discovery runs from the dashboard won't work).

### Configuration

API (`apps/api/.env`, full comments in `.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Owner connection, used for migrations and admin access |
| `DATABASE_APP_URL` | Restricted `brandmonitor_app` connection, used at runtime (RLS applies) |
| `SCANNER_URL` | The Playwright scanner service (`http://127.0.0.1:3100` locally) |
| `PORT` | API port (4000) |
| `WEB_APP_URL` | The web app's origin: CORS, the Origin check on writes, links in emails |
| `COOKIE_DOMAIN` | Session cookie domain, e.g. `.gabrielochieng.com` so the web app on a sibling subdomain sees it; empty locally |
| `DISABLE_SCHEDULERS` | `1` = no queue workers or cron dispatchers (local UI work) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google (optional; both empty = no Google button) |
| `API_PUBLIC_URL` | The API's public origin, for Google's redirect URI (`<this>/auth/google/callback`) |
| `AUTH_ENCRYPTION_KEY` | 32 random bytes, base64; encrypts 2FA secrets. Empty = 2FA can't be turned on. Never change it once set |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email alerts, invites and password resets |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_EXPLANATION_DAILY_LIMIT` | AI explanations and mention labelling |
| `TAVILY_API_KEY`, `TAVILY_MONTHLY_CAP` | Social and web search |
| `ISC_CONTACT` | Contact shown to SANS ISC in the User-Agent (optional) |
| `CT_LOG_OPERATORS` | CT log operators to read, comma-separated as in Google's log list (default `Let's Encrypt`; `all` = every names-tile log) |
| `TURNSTILE_SECRET_KEY` | Spam protection on the public report form |
| `RECHECK_CONCURRENCY` | Parallel rechecks (default 3) |

Web (`apps/web/.env.local`): `NEXT_PUBLIC_API_URL` and optionally
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

A missing optional key turns its feature off rather than crashing: no Tavily key means no
social/web search, no AI key means the explain button shows an error.

### Tests

```bash
npx tsc --noEmit -p apps/api
npx tsc --noEmit -p apps/web
npx vitest run       # the integration test needs ALLOW_DB_TESTS=1 and a local Postgres
```

GitHub Actions runs the typecheck, build and tests (against a real Postgres service) on every
push and pull request to `main`.

### Deployment

`main` auto-deploys: the web app to Vercel, and the API and scanner (one container) to a Dokploy
VPS with a shared Postgres 18 server. See `DEPLOYMENT.md`.

---

## Known limits

- **No database backups yet** (top open issue).
- **CT covers Let's Encrypt's logs only by default** (~70% of new names; Google and Sectigo logs
  aren't read), and the new-domain feeds are partial, so new lookalike domains can still be missed.
  `.co.ke` has no public zone file, and a site with no certificate never shows up in CT.
- **Parked-page detection flaps** on some live sites. Alerts are debounced; the score still swings.
- **Scans come from a European data-centre IP with a desktop browser, homepage only.** Scam kits
  that only show the scam to Kenyan mobile visitors, or hide it deeper in a booking flow, can look
  clean. See ROADMAP Phase 4.
- **No comment-section monitoring** on the brand's own posts yet (ROADMAP Phase 2).
- **Screenshots** sit on a Dokploy volume without backups, and each scan overwrites the previous
  one.
- **On the office network**, a Fortinet web filter answers DNS for known-bad domains with a block
  page (208.91.112.55, HTTP 403), so local scans of real threats don't match production.
- No error tracking; rate limits are in memory only.

---

## Project layout

```
apps/
  api/       Fastify + Prisma + TypeScript
    src/routes/    REST API (brands, findings, alert rules, members, public reports, webhooks, ...)
    src/pipeline/  discovery, recheck, scoring, cadence, source monitors, takedown watch
    src/lib/       RDAP/WHOIS, DNS, indicators, favicon/visual matching, takedown kit, search clients
    src/queue/     pg-boss setup, schedules, alert dispatch, /health/jobs
    prisma/        schema and migrations (RLS policies live in the migration SQL)
  web/       Next.js 15: overview, threat feed, finding page, settings, public report form
  scanner/   Playwright in Docker: page load, screenshot, forms, parked pages, script links
packages/
  shared/    Zod schemas, types and severity thresholds shared by api and web
```

Table and field names in `apps/api/prisma/schema.prisma` follow `ARCHITECTURE.md` §7.
