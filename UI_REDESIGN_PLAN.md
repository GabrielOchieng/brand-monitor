# Plan: UI redesign, second attempt

Decisions (owner, 2026-11-25): the 2026-11-24 redesign (`6cd0b48`) is not good enough. The problems are
the look (generic and amateur), finding things (navigation), cluttered and over-long pages, clumsy
workflows, and **the signed-in app isn't responsive on mobile**. Direction: a **security console**
(data-heavy and analyst-focused, like CrowdStrike or Recorded Future). Component library:
**shadcn/ui + Radix**. **Mockups are approved before any app code changes.**

## Why the first attempt failed

- **It was a reskin.** Tokens, fonts and the shell changed. Every page kept its old structure and flow.
- **There are no components.** The "design system" is 80 lines of CSS classes (`.card`, `.btn-*`,
  `.pill`). There's no shared Card, Tabs, Dialog, Sheet, DataTable, EmptyState or FormSection. Each page
  writes its own layout (dashboard: 109 `className`s, auto-takedown settings: 137), so pages drift apart.
- **Pages do too much.** `AutoTakedownSettings.tsx` is 827 lines, `account` 625, `dashboard` 560,
  `threats/[id]` 456. Settings is one route that switches between 12 sections with `?section=`.
- **Mobile was never checked.** Tables and multi-column grids were written for desktop only.
- **The owner saw nothing before it shipped.**

## 1. Visual direction

- **Dark by default**, with a light theme from the same tokens. Security consoles are dark, and
  analysts keep the tool open all day. Light stays for printing and screenshots that go into takedown
  reports. Both themes are CSS variables, as shadcn expects, so the second one costs little.
- **High density, one size per step.** 13px body in tables, 14px elsewhere, a strict 4px spacing grid,
  and tables first rather than cards first.
- **Colour means status, never decoration.** The surfaces are neutral graphite. Severity
  (critical/high/medium/low) and lifecycle status are the only strong colours, and each means the same
  thing on every screen. There's one accent, for focus and the primary action.
- **Data typography.** Domains, IPs, hashes and references are mono, with homoglyphs and look-alike
  characters highlighted (`jamb0jet`) because that is what an analyst checks.
- **Evidence up front.** The screenshot and "why this score" are the first things on a threat, not
  sections further down.

## 2. Information architecture

Navigation (sidebar on desktop, bottom bar + drawer on mobile):

| Group | Page | Change |
|---|---|---|
| Monitor | **Overview** | Becomes a triage start page: what needs a decision now, takedowns waiting on me, source health. Brand switcher in the top bar, not in the page. |
| | **Threats** | One queue for domains, URLs, apps and social. Saved views (New, Live, In takedown, Resolved) instead of a filter form. Status changes and bulk actions from the list. |
| | **Mentions** | Kept. It's discussion of the brand, not a threat. Linked from a threat when a mention is about it. |
| Respond | **Takedowns** | A board/table by stage: draft, sent, awaiting reply, escalated, down, reactivated. Drafts needing approval come first. |
| | **Public reports** | Kept. Each report can become a threat in one step. |
| Configure | **Brands** | Its own area, out of Settings: details, keywords, official accounts, visual reference. |
| | **Settings** | Real sub-routes (`/settings/alerts`, `/settings/takedown/sender`, …) with a section nav. The 827-line auto-takedown card becomes a 5-step setup checklist (sender, authorization, templates, recipients, Cloudflare) driven by `automationBlockers()`. |
| | **Team** | Its own page (it's in Settings today). |
| Top bar | Notifications (bell + panel), account menu, search (⌘K) | Notifications stops being a whole nav item. ⌘K jumps to any threat, domain or page. |
| Platform | **Admin** | Same shell, its own section. |

URLs used by emails (`/threats/:id`, `/takedowns`, `/invite`, `/reset-password`, `/confirm-email`,
`/report/:token`) stay the same. Old `/settings?section=` links redirect to the new sub-routes.

## 3. Workflows to redesign (not just restyle)

1. **Triage a threat.** List → detail without losing your place (detail opens in a side panel on
   desktop, a full page on mobile). Keyboard: `j/k` move, `enter` opens, `c` confirm, `d` dismiss. The
   decision buttons stay in a sticky header.
2. **Threat detail.** A header (identifier, severity, score, status, primary action), then tabs:
   **Evidence** (screenshot, score reasons, public reports), **Infrastructure** (DNS, registrar,
   hosting, certificate), **Related** (shared indicators, linked findings), **History**, **Takedown**.
3. **Take a site down.** One flow from the threat: pick a recipient → review the draft → send or queue.
   No hopping between `/takedowns`, Settings and the threat.
4. **Set up a brand / an org's takedown sending.** A checklist that shows what's missing and links
   straight to the fix, instead of long forms.

## 4. Mobile

- Every page is built and checked at 375px and 1440px. Tables become stacked rows below `md`. The threat
  detail action bar sticks to the bottom. There's no horizontal page scroll anywhere.
- Navigation below `lg` is a bottom bar (Overview, Threats, Takedowns, More).

## 5. Steps

Each step is its own commit (pushed only when the owner says so).

1. **Mockups (approval gate).** A private, clickable HTML mockup of Overview, the Threats list and
   Threat detail, in dark and light, at desktop and mobile widths. It uses **fictional brand data**
   ("Acme Air"), never Jambojet or real findings. We iterate until approved. No app code changes yet.
2. **Foundation.** Upgrade to Tailwind 4 + React 19 first (own commit; the old pages must still
   build and look the same). Then add shadcn/ui, with dark and light theme tokens as CSS variables and
   a cyan accent. Build the components: Button, Badge,
   Card, Tabs, Dialog, Sheet, DropdownMenu, Command (⌘K), Tooltip, Table/DataTable, EmptyState,
   FormSection, Skeleton, Toast. Then the new AppShell (sidebar, top bar, mobile bottom bar). The admin
   read-only view (`me.adminView`) hides every write control by default.
3. **Overview + Threats + Threat detail** (the mocked screens).
4. **Takedowns + the takedown flow.**
5. **Brands, Settings sub-routes, Team, Account, Notifications panel, Mentions, Public reports.**
6. **Admin, sign-in pages, landing page, `/report/*`.**
7. **Cleanup.** Delete the old `.card/.btn-*` classes and unused components. Update `CLAUDE.md` (Web UI
   section), `README.md` and `ARCHITECTURE.md`.

## 6. Packages (owner approved the library, 2026-11-25; list to confirm in step 2)

`@radix-ui/*` (per component), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`
(replaces `components/icons.tsx`), `tailwindcss-animate`, `cmdk` (⌘K), and possibly
`@tanstack/react-table` (sorting/selection in the threats table). All free, MIT.

## 7. Testing

- The web app has no tests today. Behaviour changes get tests: settings redirects, the bulk-action
  and keyboard triage logic, and that admin view mode renders no write controls.
- Add a Playwright smoke run (the scanner already ships Playwright) that opens every signed-in page at
  375px and 1440px against the local stack and fails on horizontal overflow or a console error.
- Pure styling changes need no tests (owner's standard).

## 8. Risks

- **Size.** This touches about 60 files. Steps 3–6 are each a few days, so the plan ships page by page,
  not as one big-bang branch.
- **Behaviour regressions** hidden inside the big components (auto-takedown settings, report drafts).
  Port the logic unchanged and change only the markup. Any logic change gets its own commit.
- **Read-only admin view.** A new write control that forgets the `adminView` check is refused by the
  API (non-GET), but it looks broken. The shared components handle it.

## Decided (owner, 2026-11-25)

1. **Theme:** dark by default, with a light toggle.
2. **Threat view:** on desktop a threat opens in a side panel over the list (`j/k` to step through
   threats), and a button expands it to the full page at `/threats/:id`. On mobile it's always a full
   page.
3. **Tailwind 4 upgrade** in step 2, with React 19, as its own commit before the new components.
4. **Mentions** stays a separate page, not a tab in Threats.
5. **Mobile bottom bar:** Overview, Threats, Takedowns, More. Notifications stays as the bell in the
   top bar.
6. **Mockups** are published as a private artifact link, with fictional data only.
7. **Baseline screenshots skipped** (step 0 dropped). Local screenshots are still used to check the
   new build on mobile.
8. **Accent:** cyan.
9. **Round 1 mockup approved** (Overview, Threats with side panel, threat page):
   https://claude.ai/artifact/VwUcCTAcR952LBCFybNxez. Source of truth for the look: IBM Plex Sans + Mono,
   graphite surfaces, 4px radius, borders over shadows, severity as the only strong colour.
10. **Round 2 approved** (Takedowns, Settings, Brands, Account, Team, Mentions, Public reports), same link.
    Product changes it brings: "Shadow review" is shown as **Test mode** (with redirect mode folded into
    it); **platform approval** is a visible step in the owner's setup checklist; on mobile a takedown
    report opens its threat's Takedown tab instead of a side panel.

## Build log

- 2026-11-25, step 2a (branch `feat/ui-redesign-v2`): React 18 → 19.3.1, Tailwind 3 → 4.3.5 via
  `@tailwindcss/upgrade`. Two traps in the upgrade tool, both fixed by hand: it renamed the takedown
  status string `"shadow"` to `"shadow-sm"` in data and copy (it treats any `shadow` token as a class),
  and it wrote a self-referencing `--font-sans: var(--font-sans)` (next/font variables are now
  `--font-inter` / `--font-jetbrains`). `npm install -w apps/web` crashes here (npm arborist
  "reading 'location'"); edit `apps/web/package.json` and run `npm install` from the root instead.
- 2026-11-25, step 2b: foundation. shadcn-style components written by hand on `radix-ui` (no shadcn
  CLI: it shells out to the same broken `npm install`): `components/ui/` Button, Panel, Field +
  FormSection, Switch, Tabs + LinkTabs, Dialog + Sheet, Menu/Popover/Tooltip, Toast, Banner;
  `components/threat/atoms.tsx` (severity, score, status, type, live state, `Ident` with look-alike
  characters marked, `lib/homoglyph.ts`). Theme tokens in `app/theme.css` (dark default,
  `data-theme="light"`, saved in `localStorage` `bm.theme`, applied before paint). New shell in
  `components/shell/` (sidebar, top bar with brand switcher / search / bell / account menu, phone
  bottom bar + More sheet, Ctrl K palette); `lib/brand.tsx` shares the selected brand. Old
  `AppFrame`, `HeaderMenus`, `NotificationBell` deleted. Legacy tokens stay in `globals.css` until
  every page is migrated. Pages are still the old design inside the new shell.
- Local visual checks: API with `DISABLE_SCHEDULERS=1`, `next start -p 3210`, a local-only test user
  `ui-test@localhost.test` (created with `auth:create-user`). On this machine headless Chromium can't
  reach 127.0.0.1 (ERR_NETWORK_ACCESS_DENIED) but can reach `::1`; the API binds IPv4 only, so a small
  `[::1]:4000 -> 127.0.0.1:4000` relay is needed for screenshots.
- 2026-11-25, bridge: legacy tokens and `.card/.btn-*/.field` now point at the theme variables, and
  hard-coded Tailwind palette colours were mapped to semantic tokens, so pages not yet rebuilt work
  in both themes.
- 2026-11-25, step 3: Overview, Threats and the threat page rebuilt. API additions (pure helpers in
  `apps/api/src/lib/findingView.ts`, tested): `GET /api/findings` gains a `type` filter, per-row
  `webState` (live/parked/offline) and `topReason`, and `statusCounts` for the view tabs;
  `/api/dashboard/summary` gains `newPerDay` (14 days), `liveOpen`, `takedownsDone` (30 days +
  median days) and `webState`/`topReason` on attention items. Web: `components/threat/`
  (ThreatQueue with keyboard triage + bulk bar + side panel, ThreatPanel, ThreatView with tabs in
  `?tab=`, Evidence blocks, shared status hook with Undo). `FindingLifecycle` is now controlled by the
  page for status. Old ThreatsTable/ThreatFilters/PendingNavigation deleted. Not yet restyled
  (bridged): AI explanation, indicators, related, takedown tracker, report drafts (step 4).
  Gap: the web app has no component-test setup, so keyboard triage and the bulk bar are checked by
  hand in the browser, not by tests.
- 2026-11-25, step 4: takedowns. `components/takedown/`: ReportFlow (the threat's Takedown tab as one
  flow: pick a channel with its recipient shown, first report / follow-up, prepare, then the
  DraftEditor: thread, fields, attachments, send / approve / retry / mark reported / cancel / test /
  rewrite / delete; same API calls as the old ReportDrafts), TakedownLog (do-it-yourself kit +
  requests and outcomes + manual log; was TakedownTracker + TakedownKit), ReportPanel (Takedowns
  side panel reusing DraftEditor, plus Right/Wrong for test-mode reports). Takedowns page: summary
  strip, "automatic sending is off" banner from `automationBlockers`, tabs in the URL (`?tab=`), table
  + panel, phone list linking to `/threats/:id?tab=takedown&report=:id`. `components/ui/Confirm.tsx`
  replaces window.confirm/prompt here (the rest go in step 5). Status names: shadow = "Test mode",
  pending_veto = "Sending soon". No API changes. Checked locally with 4 drafts made through the UI and
  moved into queue states by SQL, deleted afterwards; no Send button was clicked.
- 2026-11-25, step 5: Settings is a layout with a section menu and one route per section
  (`/settings/alerts`, `/webhook`, `/report-templates`, `/report-recipients`,
  `/automatic-reporting` + `/sending`, `/sender`, `/authorization`, `/cloudflare`, `/history`; one
  overview request shared by `AutomationProvider`). The automatic-reporting setup is a checklist built
  from `automationBlockers`. `/settings?section=` and `?tab=` redirect (`lib/settingsRoutes.ts`,
  tested). `/brands` (tabs in `?tab=`, add with `?add=1`) and `/team` are their own pages. Account is
  one panel of label-left sections; Mentions, Public reports and Notifications rebuilt
  (`lib/notificationHref.ts`, tested, also fixes report-only notifications in the bell and the
  Overview feed). Stages shown as "Test: prepare only" / "Test: send to yourself" / "Live". The
  mockup's "Send to Threats" on a mention was left out: there is no API for it. Browser dialogs remain
  only in the admin panel (step 6).
