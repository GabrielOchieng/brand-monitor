# Detection roadmap

What enterprise brand-protection tools (ZeroFox, BrandShield, Bolster, Netcraft) detect on the
web and social media that Brand Monitor doesn't, and the plan to close the gaps that can be
closed at $0. Written 2026-11-20. Operational issues (backups, error tracking) are tracked
separately in `CLAUDE.md` → Open issues.

Each phase ships on its own and updates README / ARCHITECTURE "As built" when it lands.

---

## Gaps

### Web
| # | Gap | Why it matters | Free fix? |
|---|-----|----------------|-----------|
| W1 | Only sites whose **name** resembles the brand are found | A clone at an unrelated name (`cheap-flights-ke.shop`) copying Jambojet's site is invisible to discovery, NRD and CT | Yes: web search for the brand's content (Phase 1) |
| W2 | **Fake customer-care numbers** aren't searched for | The most common airline scam: "Jambojet customer care 07…" on fake pages and listings | Yes (Phase 1) |
| W3 | **Cloaking**: scans come from a European data-centre IP with a desktop browser | Scam kits often show the scam only to Kenyan mobile visitors | Partly: mobile profile (Phase 4). A Kenyan/residential IP is paid |
| W4 | **Homepage only** | jambo-jet.com's WhatsApp hand-off was three clicks into a booking flow (caught via its JS, by luck of a static bundle) | Yes: follow the funnel (Phase 4) |
| W5 | **New-domain coverage holes**: whoisds NRD feed is a 70k/day sample (hagezi/nrd's ~390k/day list and SANS ISC's ~335k/day CT + zone-file list added 2026-11-21); crt.sh (CT) is down; `.co.ke` not covered | Missed `flyjambojetkenya.store` | Partly: CZDS zone files, own CT reader (Phase 5). `.co.ke` has no public zone file |
| W6 | **Free-hosting subdomains** (`*.vercel.app`, `*.netlify.app`, `sites.google.com/…`) found only if a phishing feed lists them | Cheapest place to host a scam | Partly: web search (Phase 1) finds the ones search engines index |
| W7 | **Email readiness** of lookalikes not checked | A lookalike with MX records is set up for fake job / invoice email | Yes (Phase 5) |
| W8 | **Android apps** not monitored (iOS only) | Kenya is overwhelmingly Android | Yes, via an unofficial scraper (Phase 3) |

### Social
| # | Gap | Why it matters | Free fix? |
|---|-----|----------------|-----------|
| S1 | **Comment-section scams** on the brand's own posts | Fake "Jambojet Care" accounts answer complaints with "DM us on WhatsApp 07…" | Facebook/Instagram: likely, via Meta's API on the brand's own Page (Phase 2, needs verification). X: paid API |
| S2 | **Recruitment scams** ("cabin crew training fee") not searched for | Common in Kenya | Yes (Phase 1) |
| S3 | Only what search engines indexed in the **past month**; private groups, Stories, Marketplace, WhatsApp groups/Channels invisible; Telegram thin | Fresh scams are missed for hours to days | No: needs paid platform data |
| S4 | **Scam ads** | Sponsored "cheap tickets" posts are a major channel | No: Meta's Ad Library API excludes Kenyan commercial ads |
| S5 | **Logo / profile-picture** matching | Fakes use the logo with an unrelated name | No: profile images can't be fetched without scraping |
| S6 | **Speed**: social search runs daily | Enterprise tools are near-real-time | Partly: more frequent runs cost search credits |

### Paid-only (out of scope while the $0 constraint holds)
Real-time platform data partnerships (S3, S6), ads monitoring (S4), Kenyan/residential scanning
IPs (W3), logo recognition at scale (S5), X API for replies (S1).

---

## Search budget

Tavily's free plan is 1,000 credits a month; `TAVILY_MONTHLY_CAP` stops at 900. Today, per brand:
4 brand searches + 2 number pivots a day ≈ 186/month, plus 4 weekly fact-checks and up to 3
manual runs a day.

Phase 1 adds 4 searches, split so the total stays under the cap for one brand with room for manual
runs: customer care and recruitment **daily** (+2/day), general-web brand content **every other
day** (2 searches → +1/day on average). New total ≈ 280/month per brand. Beyond ~3 brands the cap
binds; at that point some searches need to drop to weekly, or the budget split per brand
(noted in the job).

---

## Phase 1: new searches (W1, W2, S2, W6) — small, ~1–2 days

**Shipped 2026-11-20** (`pipeline/webSearchFindings.ts`, `lib/recruitmentScam.ts`), changed from the
plan below after a live test: most non-social hits were legitimate travel, job and news sites, so
instead of scanning every unknown site that names the brand (and keeping an allowlist), a non-social
result becomes a `web_search` finding only when the result itself names the brand **and** shows a
foreign number, a brand-like site name, or a recruitment-fee pitch. No `web_search_allowlist` column.
The booking pitch runs daily, alternating between two wordings (3 web searches/day, ≈276
credits/month per brand). `RECRUITMENT_FEE` is +30. W1 is only partly closed: a clone on an
unrelated name whose search result shows no number is still missed. First live run: TikTok
`@jambojet72` (customer-care pitch with a foreign number, via the social path) and two travel-agent
pages quoting their own numbers (low-scoring noise); no recruitment-fee scams.

**Customer-care numbers (W2).** Daily search across the general web (no domain filter) for
`"<brand> customer care number"` / `"<brand> contact" "WhatsApp"`. From each result's title and
snippet, extract phone/WhatsApp numbers (`lib/indicators.ts`) and drop the brand's own
(`socialOwnIndicatorKeys`). A result with a foreign number on a social URL becomes a social finding
(existing path); on any other site, the URL is queued as a `url` finding with source `web_search`
through the same path manual submissions use, so it gets scanned, scored and kit-ready.

**Recruitment scams (S2).** Daily search for `"<brand> recruitment" OR "<brand> jobs" OR
"<brand> cabin crew"`, social and general web. Flag results that name the brand and give a foreign
number or ask for a fee (`fee|pay|registration|training cost`). Scored by a new
`RECRUITMENT_SCAM_SIGNALS` rule.

**Brand content on unrelated domains (W1, W6).** Every other day, two general-web searches for the
brand's booking language (`"<brand>" book flights`, `"<brand>" offer tickets`), excluding the
brand's own domains. Any result on a domain that isn't the brand's, isn't already a finding and
isn't a known news/travel site (a small allowlist, editable per brand) is queued for a scan as a
`url` finding, source `web_search`. The scan + score decide whether it's a threat; nothing is
alerted on the search hit alone.

**Changes.** `pipeline/webSearchMonitorJob.ts` (or extend `socialSearchMonitorJob.ts` with a
`web` query kind); a per-brand allowlist (`brands.web_search_allowlist` text[]); scoring rule;
`/health/jobs` source entry; tests built from real results.

**Done when** a live run finds at least one previously unknown page and nothing official.

## Phase 2: comments on official posts (S1) — medium, depends on Meta

**Prerequisite (verify first, before any code):** a Meta app with the brand's Page connected by a
Page admin, and whichever permission Meta currently requires to read comments on the Page's own
posts. Meta's docs disagree between `pages_read_engagement`, `pages_read_user_content` and Page
Public Content Access, and some need App Review. Test with a Page token in Graph API Explorer;
if it needs App Review, budget the time for it. Instagram comments need the Instagram account
linked to the Page.

**Build.** Every 2 hours, read comments on the Page's posts from the last 7 days. A comment
becomes a social finding (the commenter's account) when the commenter isn't the brand and the
comment gives a foreign number, a WhatsApp/Telegram link, or "DM/inbox us" language combined with
a brand-like name. Alert immediately (`social_comment_scam`): these target customers who are
actively complaining, so speed matters. Token storage: encrypted per brand; refresh handling.

**Not included:** X replies (paid API).

## Phase 3: Google Play (W8) — small–medium

**Shipped 2026-11-20** (`lib/googlePlaySearch.ts`, `lib/appListings.ts`, inside
`pipeline/appStoreMonitorJob.ts`). Changed from the plan below: no `brands.official_app_ids` column —
App Store and Google Play links go in the existing official accounts list (compared by store + app
id), which also gives the iOS monitor the official-app exclusion it lacked. Names are matched with
`nameResemblesBrand` (lookalikes too), Kenya storefront, `google_play` source on `/health/jobs`
(stale after 24h). Live run: 20 results, only the real FlyJambojet app
(`com.jambojet.booking.twa`) matched; no fakes listed.

No official search API. Use an unofficial scraper (`google-play-scraper` on npm), which may break
when Google changes its pages and sits outside Google's terms for automated access: same
treatment as the App Store monitor (`lib/appStoreSearch.ts`), every 4h, flags apps whose name or
developer resembles the brand and aren't the brand's own (`brands.official_app_ids`). Failures
show on `/health/jobs`. APK mirror sites (APKPure etc.) come later through the Phase 1 web search.

## Phase 4: scanner realism (W3, W4) — medium

**Mobile profile.** Scan as a mid-range Android phone (Playwright device descriptor, Kenyan
locale/timezone `en-KE` / `Africa/Nairobi`). Keep the desktop scan for the visual-similarity
baseline; compare: a page that differs strongly between the two is flagged `CLOAKING_SUSPECTED`.

**Funnel following.** After the landing page, click up to 3 elements whose text matches
booking/payment/contact words (`book|pay|continue|checkout|whatsapp|buy`), one at a time, collecting
links, script links and a screenshot per step. Never type into or submit forms. Cap at 25s extra
per scan; the scanner shares a container with the API, so concurrency stays at
`RECHECK_CONCURRENCY`.

## Phase 5: domain coverage (W5, W7) — medium–large

**Zone files (CZDS).** Apply for CZDS access to the gTLDs scammers use most (`.shop .store .site
.online .xyz .top .info .live` and similar). Access is free, but each registry approves on its
own schedule (no deadline; some take weeks), one download per day, renewed every few months.
Daily job: download, diff against yesterday's list (kept on the screenshots volume), run new
names through `brandMatcher`. `.com/.net` need Verisign's separate agreement. Replaces the 70k/day
NRD sample for covered TLDs; keep the NRD feed for the rest.

**Own CT reader.** Replace crt.sh: poll a few large CT logs' `get-sth` / `get-entries` directly,
parse certificate names, match against brands. Heavier (continuous polling, certificate parsing)
and needs care with the VPS's CPU; scope it after Phase 1–4.

**Email readiness (W7).** On recheck, look up MX records for domain findings; a lookalike gaining
MX records fires a `mail_ready` alert and scores `MX_CONFIGURED`.

---

## Order
1. ~~Phase 1~~ (shipped 2026-11-20).
2. Phase 2: verify Meta access first; build only if a Page token can read comments.
3. ~~Phase 3~~ (shipped 2026-11-20).
4. Phase 4.
5. Phase 5: apply for CZDS early, since approval takes weeks, even though the build comes last.
