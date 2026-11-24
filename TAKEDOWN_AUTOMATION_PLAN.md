# Plan: automated takedown reporting (draft v2, for discussion)

Lets any organization have abuse reports for its **websites** (findings of type `domain` / `url`)
prepared and sent automatically, from its own mailbox, to recipients and with wording it controls.
Off by default for every org. Social findings and SMS/app channels are never automated (hard-coded).

Research behind this plan is in §13 (sources at the end).

---

## 1. Switches (all must be on before anything is sent)

| Level | Who | What |
|---|---|---|
| Platform | env `AUTO_TAKEDOWN_ENABLED` | Global kill switch. |
| Org allowed | Platform admin (`/admin`, audit-logged) | Only after the org's authorization (§4) is on file. |
| Org enabled | Org owner | Once a sender is connected, templates approved and shadow mode done. |
| Brand | Owner / admin | On/off and policy overrides per brand. |
| Channel | Owner / admin | Mode per channel (§6). |

Pausing monitoring (org or brand) pauses sending too (`listMonitoredBrands()`). Any owner, admin or
analyst can hit **Stop all sending** for the org. It takes effect at once, and only an owner can undo it.

## 2. Sender: the org's own mailbox

The mail must leave through the org's own mail system, or SPF/DKIM/DMARC fail and abuse desks drop
it. We never send mail claiming to be the org's domain through our own SMTP.

| Type | How | Notes (from research) |
|---|---|---|
| Microsoft 365 | Graph `sendMail`, app-only, scoped to **one mailbox** with *RBAC for Applications* | Microsoft says RBAC for Applications replaces Application Access Policies. Don't build on the old one. SMTP with a password (basic auth) is off by default from end of Dec 2026, so we don't offer it for 365. |
| Google Workspace | Gmail API, service account with domain-wide delegation, `gmail.send` for one user | Sends count against that user's limit: ~2,000/day, rolling 24h, ~60/min API rate. |
| Other | SMTP on the org's own server (OAuth or password) | Fallback. |

Per sender we also store: **From name**, **Reply-To** (e.g. a ticketing address), an optional
**BCC archive** address (the org keeps its own copy of everything sent), and the signature block.
Credentials are encrypted with `AUTH_ENCRYPTION_KEY`. Setup runs a test send and a DMARC lookup.

## 3. Recipients: who reports go to

**3.1 Default recipient per channel.** It's resolved for each finding:
registrar abuse email (RDAP/WHOIS), host abuse email (IP RDAP), CERT, blocklists.

**3.2 Contact book (routing table).** It overrides the default. There are two layers:
- *Platform contact book* (curated by platform admins, shared by all orgs): e.g. "GoDaddy -> web form
  only, needs full URL path, site live with a login area" (GoDaddy takes phishing reports by form,
  not email). Also registrars/hosts that have an API, or a better address than RDAP gives.
- *Org contact book* (per org): their own overrides, e.g. a registrar contact they have a
  relationship with, a national CERT, an internal legal address.
- Keyed by registrar IANA ID / name, host ASN / org name, or TLD. The most specific match wins, and the
  finding page shows which rule matched and why.

**3.3 Fixed recipients per channel.** The org can always add To/CC/BCC addresses on a channel
(e.g. CC legal on every registrar email, BCC the brand team).

**3.4 Per-finding override.** Before sending (or while a report waits in the veto window), an analyst can
change To/CC for that one report. That makes it a saved draft (§5.3).

**3.5 Redirect (test) mode.** A per-org setting: "send every report to `<address>` instead of
the real recipient". Real emails are built and delivered to the org's own inbox, with the intended
recipient shown at the top. This is used during setup and template testing.

**3.6 Safety rules on recipients**
- Never send to the org's own domains or to addresses on an org "never send to" list.
- Never send to an address that bounced in the last N days. A bounce flags the contact for review.
- When no recipient resolves, the report becomes a manual task. The app never guesses.

## 4. Authorization (required before a platform admin allows it)

The research shows platforms and registrars commonly ask for a **letter of authorization (LOA)**,
issued by the rights owner, naming an authorized enforcement signatory, and often a **trademark
registration** as well.

Per org (or per brand):
- the authorized signatory (name, title, contact), date, scope (brands/domains), expiry;
- uploads: signed LOA, trademark registration certificates (stored with the evidence);
- per channel: "attach LOA / trademark" (off / always / on request).

When the LOA expires, automatic sending stops and the owner gets an alert. A platform admin checks the
record before switching on "org allowed".

## 5. Templates and drafts

**5.1 Templates (per org, optional per brand).** There's one template per channel and message kind:
first report, follow-up, escalation, plus the blocklist form text. Each has a subject and a body with
placeholders. Examples: `{{finding.url}}`, `{{domain}}`, `{{registrar.name}}`, `{{registrar.ianaId}}`,
`{{registeredAt}}`, `{{nameservers}}`, `{{ip}}`, `{{hostingOrg}}`, `{{firstSeenUtc}}`, `{{lastSeenLiveUtc}}`,
`{{reasons}}`, `{{indicators}}`, `{{screenshotUrl}}`, `{{brand.name}}`, `{{brand.officialDomain}}`,
`{{signatory.name}}`, `{{signatory.title}}`, `{{reportRef}}`.
- Ships with good defaults, based on today's takedown-kit text plus §13.3.
- **Locked blocks** that a template can't remove: the evidence block, the signature/authorization
  block, and the `[BM-<ref>]` reference tag (needed for reply matching).
- Checked on save: an unknown placeholder or a missing locked block refuses the save.
- **Preview** against a real finding, and "send test to me".
- **Versioned and approved**: an analyst can edit, but only an owner/admin publishes a version.
  Automatic sending only uses *published* versions, and each sent report records the version it used.
- Languages: one variant per language, chosen in the contact book (e.g. a French-speaking registrar).

**5.2 Fixed text per org.** Signature, legal disclaimer, footer and company details are set once and
used by every template.

**5.3 Drafts per finding.** "Prepare report" renders the template into a **draft**, saved on the
finding (`takedown_actions` in status `draft`). An analyst can edit the recipients, subject and body,
add or remove attachments, and save it. Then:
- *Send now*, or
- *Queue*: the draft is sent by the dispatcher per the channel mode. The saved draft is used
  as-is. The app does not re-render over a human's edits, but it does re-check eligibility (§7).
- Drafts are kept as evidence of exactly what was sent (the message is frozen once sent).
- An automatically created report is also a draft first. In *Delayed* mode it stays editable until `send_after`.

## 6. Channels and modes

| Channel | How | Automatable? (research) |
|---|---|---|
| Registrar abuse email | Org mailbox | Yes |
| Host / CDN abuse email | Org mailbox | Yes. File in parallel with the registrar, not after it (content comes back on new hosting while the registrar queue is open). For sites on free hosting (github.io, pages.dev, vercel.app…) go to the host only. |
| **NetBeacon Reporter** | API (account) | Probably. It's free (funded by PIR), standardises and enriches reports and routes them to the registrar. API access terms are still to be confirmed. |
| Cloudflare | Abuse Reports API | Only for orgs whose Cloudflare account has the abuse-reports entitlement (Enterprise by default, others must ask). Otherwise a manual form task. |
| National CERT (configurable list; KE-CIRT/CC for Kenya) | Org mailbox | Yes |
| Netcraft | Report API | Needs a Netcraft account/API key. The terms aren't public, so confirm with Netcraft first. Until then, manual form. |
| APWG `reportphishing@apwg.org` | Email | Meant for forwarding phishing *emails*, so it only fits findings that came with an email sample. |
| Google Safe Browsing | Web form | No. The Web Risk Submission API is "contact sales" (paid), which breaks the $0 rule. |
| GoDaddy, others that are form-only | Web form | No. These become manual tasks with the text prepared. |
| Namecheap Phishing Reports API | API | Invite-only for vetted "trusted providers", who must attach a screenshot. Access can be lost by reporting legitimate sites. Apply only once we have a track record. |
| ICANN Compliance complaint | Web form | No. It's the escalation step for gTLDs when a registrar ignores actionable evidence. Not for ccTLDs like .ke. |

Mode per channel: **Off** (manual, as today) · **Approval** (draft prepared, an analyst sends) ·
**Delayed** (sent after a veto window unless cancelled) · **Automatic**.
Suggested defaults when an org switches on: registrar/host/CERT = Delayed, NetBeacon = Delayed,
blocklists = Automatic once approved.

## 7. Which findings qualify (policy per org/brand, strict defaults)

Research point: registrars act on **DNS abuse (phishing, malware, fraud)**, not on trademark
complaints alone. Rapid7 won't ask for a takedown when a site has no login fields and isn't luring
victims into giving personal details. So automation is only for clear fraud. Pure brand-abuse or lookalike
cases stay manual (UDRP / legal).

A finding qualifies when all of these hold:
- type `domain` / `url`; live on at least 2 consecutive scans (`first_live_at` / `down_streak`, so
  parked-detector flaps don't send);
- not dismissed or false positive; not on the org allowlist (own domains, partners, resellers, agents);
- **fraud evidence**, at least one of: a credential or payment form; a fake contact or payment detail
  (indicator) shared with a confirmed finding; a scam-pattern match (recruitment fee, fake
  customer care, booking pitch); **or** an analyst has confirmed it as fraud;
- the score is at or above the org's threshold (default: critical) unless analyst-confirmed;
- a screenshot exists from a live scan within the last 24h (Namecheap requires one; evidence that
  can't be checked is the top reason requests are rejected).

Analyst-confirmed findings can skip the veto window (an org setting). Everything is checked again
just before sending: down, dismissed or cancelled means the report is skipped, with the reason recorded.

## 8. Evidence in every report (what makes it actionable)

Write for a non-specialist reader: at many registrars, abuse reports are handled by support or
compliance staff. Every first report contains, in this order:
1. One line: what it is ("phishing site impersonating `<Brand>` collecting card details").
2. The full URL (with path) and the domain, defanged in the subject only.
3. Why it's fraudulent: the reasons, in plain words, and the official domain it imitates.
4. Registration facts: registrar name + **IANA ID**, creation date, nameservers, IP, hosting org.
5. Timestamps in **UTC**: first seen, last seen live.
6. Screenshot (attached and linked); indicators (phone numbers, wallets, accounts).
7. The specific action asked for (registrar: suspend / `clientHold`; host: remove the content).
8. Who is reporting and on whose authority (signatory, LOA reference/attachment).

One domain per report by default. A per-org setting allows a daily digest per registrar instead.

## 9. Queue and dispatch

- New table `takedown_actions` (RLS): finding, channel, kind (first / follow-up / escalation),
  status (`draft | shadow | awaiting_approval | pending_veto | sending | sent | failed | cancelled | skipped`),
  `send_after`, resolved recipients + which contact-book rule matched, frozen subject/body/attachments,
  template version, provider message ID, who created/edited/sent/cancelled it, and why it qualified.
- On `sent`, the existing `Takedown` row (`requested`) is created, so the tracker keeps working.
- A `takedown-dispatch` job runs every 5 minutes and uses `listMonitoredBrands()`.
- No duplicates: one first report per finding per channel unless an analyst re-sends it.
- Caps: per org per day, per recipient per day, and below the sender's provider limit (Gmail
  ~2,000/day). Hitting a cap holds reports. It never drops them.
- New alert types through the existing rules: `takedown_queued` (with a cancel link),
  `takedown_sent`, `takedown_failed`, `takedown_reply`, `sender_broken`, `loa_expiring`.

## 10. Shadow mode, then redirect mode, then live

1. **Shadow** (default 14 days): nothing is sent. The app records what it would have sent, and analysts mark each one right/wrong.
2. **Redirect**: real emails go to the org's own address (§3.5), to check templates and deliverability.
3. **Live**: the owner switches on once the shadow-mode false-positive rate is shown.
   They can drop back to shadow mode at any time.

## 11. Replies, follow-ups, escalation, completion

- **Replies** (optional read permission: Graph `Mail.Read` scoped by the same RBAC, or `gmail.readonly`):
  match by thread / `[BM-<ref>]`. Store the reply on the finding, set the takedown to `acknowledged`,
  pull out a ticket number, alert the analyst. Never auto-answer a registrar's questions. Bounces
  mark the contact as bad (§3.6).
- **Follow-up**: no reply after N days (default 2, based on the UK NCSC's 48h target for
  registrars) and still live -> one follow-up email.
- **Escalation**: still live after M days (default 5; one vendor reports a median of 5 days) ->
  next channel (host, NetBeacon, CERT). For gTLDs, add a manual "ICANN Compliance complaint" task
  (registrars must act on actionable evidence under RAA §3.18 since April 2024).
- **Completion**: the takedown watch's "down on 2 scans" marks open takedowns `completed`.
  `site_reactivated` re-queues reports (subject to the policy).

## 12. Roles

| Role | Can |
|---|---|
| Owner | Sender, authorization/LOA, switches, publish templates, policy, modes, redirect/shadow |
| Admin | Policy, modes, contact book, allowlist, publish templates, approve/cancel |
| Analyst | Edit drafts and templates (unpublished), approve/send/cancel, mark shadow results, stop all |
| Viewer | Read queue, drafts and sent messages |
| Platform admin | Allow/disallow per org, edit the platform contact book, read-only view (GETs never write) |

Every change and send/cancel goes into the org's history; platform-admin actions go to `admin_audit_log`.

## 13. Research notes

1. **Sending.** Microsoft: SMTP basic auth unchanged until Dec 2026, then off by default for
   existing tenants, with removal to be announced in H2 2027. Modern-auth SMTP stays. RBAC for
   Applications replaces Application Access Policies for scoping an app to mailboxes. Google:
   delegated sends count against the impersonated user's ~2,000/day limit.
2. **Who acts on what.** ICANN 2024 amendments (effective 5 Apr 2024): a registrar with actionable
   evidence of DNS abuse must act promptly (RAA §3.18.2). 192 compliance investigations in the first
   six months. Registrars act on phishing, mostly not on trademark complaints alone. ccTLDs (.ke) sit
   outside ICANN contracts. KeNIC mentions "AbuseShield", but no public reporting process was found,
   so ask KeNIC.
3. **Why takedowns fail** (PhishFort, Cyble, Rapid7): evidence that can't be checked, wrong recipient,
   dense technical reports. Keep it simple; include registrar + IANA ID, dates, nameservers, abuse contact;
   file with registrar and host in parallel; free-hosting sites go to the host directly.
4. **Shared services.** NetBeacon Reporter: free, standardised, enriched, routes to registrars,
   has a submission API. Registrars complain about inactionable reports through it, so the same
   quality bar applies. Phish.report (curated abuse contacts) is paid. Its contact-book idea is what
   §3.2 copies.
5. **Authorization.** LOA issued by the rights owner, naming an authorized signatory, with all fields
   complete. A trademark registration is often required too.

## 14. Order and size

**Status:** step 1 shipped 2026-11-25 (setup only; nothing sends automatically). Differences from the
plan: an uploaded LOA is recommended, not required (the authorization record is); the `loa_expiring`
and `sender_broken` alerts move to step 4 with the dispatcher; Microsoft Graph and Gmail sending were
checked only up to their sign-in errors (no real tenant yet), SMTP end to end against Mailpit.

Step 2 shipped 2026-11-26: templates and per-finding drafts. Differences: a draft can't be sent to its
recipients yet (no "Send now" / "Queue" until step 4, so nothing reaches a real recipient before shadow
and redirect mode); drafts and templates can only be tested on the member asking. The per-channel
"attach LOA" setting (§4) became a per-draft choice. Channels: registrar, host, cert, blocklist (one
web-form text for Netcraft/NetBeacon/Safe Browsing). The registrar IANA ID wasn't stored anywhere;
it now is (`domain_intel.registrar_iana_id`, filled on the next recheck of each finding).

Step 3 shipped 2026-11-27: recipients. Differences: host rules match the hosting org's name (no ASN
is stored); an entry can also say "don't report here"; blocklist entries list every matching web form;
the national CERT is no longer built in (each org adds its own); the own-domain rule applies to To only,
so Cc/Bcc to the org's own people (e.g. legal) is allowed; bounce entries arrive with step 5.
Redirect mode is stored and shown; it takes effect when sending exists (step 4).

Step 4 shipped 2026-11-28: sending. Differences: "live on 2 scans" needed a new counter
(`findings.live_streak`); approving a report by hand needs the same switches as automatic sending; a
report interrupted mid-send is marked failed (check the sent folder), never re-sent automatically;
blocklist channel can only be off or "approval", which makes a manual task (they're web forms).
The per-registrar daily digest (§7) is not built.

Step 5 shipped 2026-11-29: replies (Graph and Gmail only, no IMAP, by decision), bounces, follow-ups,
escalation, completion. Differences: the recipient's ticket number replaces our tag as the tracker
reference; out-of-office replies are ignored; escalation goes registrar -> host -> CERT, one step per
report; open takedown requests now put a finding under the post-takedown watch so "confirmed down" can
close them.

Step 6 shipped 2026-11-30: Cloudflare's abuse-reports API only (decision: NetBeacon and Netcraft wait
until their terms for a multi-org service are confirmed). The report-type path segment `abuse_phishing`
is inferred (the docs show a placeholder); a rejection shows as a failed report. Not tested against an
entitled account (none available); the connection check was run against the real API (401 for a dummy token).

1. Sender connections (Graph/Gmail/SMTP), test send, authorization + LOA, switches, stop-all (~2 days)
2. Templates (placeholders, locked blocks, versions, preview) + per-finding drafts (~2 days)
3. Recipients: resolution, platform + org contact book, fixed recipients, redirect mode, safety
   rules (~1.5 days)
4. Policy, `takedown_actions`, dispatcher, modes, caps, shadow mode, UI (~2–3 days)
5. Replies, bounces, follow-ups, escalation, auto-complete (~2 days)
6. API channels: NetBeacon, then Cloudflare (for entitled orgs), Netcraft once terms are known (~1–2 days)
7. Metrics: time to takedown per registrar/host/channel, acknowledgement and success rates (~1 day)

About 11–13 days. Each step ships on its own. Nothing sends to a real recipient until step 4 has
run shadow + redirect.

## 15. Open questions

- NetBeacon: API access for a SaaS submitting on behalf of several orgs? Contact them.
- Netcraft: report-API terms and key. Contact them.
- KeNIC: does AbuseShield accept reports, and how?
- Default veto window: 6h, or business hours in the org's time zone?
- Digest per registrar: default off?
- Jambojet: 365 or Workspace; who signs the LOA; trademark certificates available?

## Sources

- Microsoft SMTP AUTH timeline: https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835
- Microsoft RBAC for Applications: https://learn.microsoft.com/en-gb/graph/auth-limit-mailbox-access
- Gmail sending limits: https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace · https://developers.google.com/gmail/api/reference/quota
- ICANN DNS abuse amendments: https://icann.org/resources/pages/advisory-compliance-dns-abuse-obligations-raa-ra-2024-02-05-en · https://Icann.Org/resources/pages/global-amendment-2024-en
- NetBeacon: https://dnsabuseinstitute.org/?p=7642 · https://pir.org/?p=11174
- Cloudflare abuse reports API: https://developers.cloudflare.com/api/resources/abuse_reports/index.md
- Netcraft API (community clients): https://xsoar.pan.dev/docs/reference/integrations/netcraft-v2 · https://sourceforge.net/projects/netcraft-api-client
- Google Web Risk Submission API: https://docs.cloud.google.com/web-risk/docs/submission-api
- Namecheap Phishing Reports API terms: https://namecheap.com/legal/phishing-reports-api/phishing-reports-api-tou
- GoDaddy abuse reporting: https://www.godaddy.com/help/reporting-abuse-27154
- APWG: https://apwg.org/reportphishing/
- Takedown practice: https://phishfort.com/domain-takedowns/ · https://cyble.com/articles/anti-phishing-domain-removal/ · https://docs.rapid7.com/threat-command/preparing-for-a-suspicious-domain-takedown/ · https://www.ncsc.gov.uk/collection/security-practice-domain-registrars/use-abuse-reporting-tools-aggregators
- LOA practice: https://docs.fortinet.com/document/fortirecon/25.1.0/user-guide/192584
- KeNIC: https://kenic.or.ke/how-fake-domain-names-can-destroy-your-brands-reputation/
- Phish.report: https://phish.report/pricing
