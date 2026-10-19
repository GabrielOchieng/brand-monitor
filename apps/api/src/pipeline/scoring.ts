import { severityForScore } from "@brand-monitor/shared";
import { similarityRatio } from "../lib/levenshtein";
import { isHighRiskTld } from "./permutations";

export interface ScoreEvent {
  delta: number;
  reason: string;
  ruleCode: string;
}

export interface ScoringInput {
  domain: string;
  brandRoot: string;
  isHomoglyph: boolean;
  registeredAt: Date | null;
  faviconMatch: boolean;
  visualSimilarity: boolean;
  hasLoginForm: boolean;
  hasPaymentForm: boolean;
  pageTitle?: string | null;
  pageText?: string | null;
  looksParked: boolean;
  isAllowlisted: boolean;
  appStoreImpersonation: boolean;
  phishFeedListed?: boolean;
  // The most-shared contact/payment detail on this page, if any other finding of the same
  // brand shows it too (lib/indicators.ts, recheckJob.ts).
  sharedIndicator?: { label: string; value: string; otherFindings: number } | null;
  // Page gives an M-Pesa paybill/till or crypto wallet to pay into.
  hasPaymentDestination?: boolean;
  // Non-dismissed public reports pointing at this finding (routes/publicReports.ts).
  publicReportCount?: number;
  // Set only for a social-media account finding (lib/socialUrls.ts). Its "domain" is the
  // platform's, so none of the domain-name rules apply -- these two replace them.
  social?: { handleImpersonation: boolean; contactDetails: boolean } | null;
}

export interface ScoringResult {
  score: number;
  severity: ReturnType<typeof severityForScore>;
  events: ScoreEvent[];
}

// Deterministic, additive, explainable -- every point traceable to a named rule.
// Reduced ruleset vs. the full ARCHITECTURE.md §6 model to match what the POC actually
// collects.
function mentionsBrand(text: string | null | undefined, brandRoot: string): boolean {
  return Boolean(text) && text!.toLowerCase().replace(/[\s._-]+/g, "").includes(brandRoot);
}

export function computeScore(input: ScoringInput): ScoringResult {
  const events: ScoreEvent[] = [];
  if (input.social) {
    scoreSocialAccount(input.social, events);
  } else {
    scoreDomainName(input, events);
  }

  if (input.faviconMatch) {
    events.push({ delta: 15, reason: "Website favicon matches the protected brand's favicon", ruleCode: "FAVICON_MATCH" });
  }

  // Coarse, noisy heuristic (regional average-hash over a page screenshot, see
  // lib/visualSimilarity.ts) -- catches an exact/near-exact page clone, not a
  // redesigned-but-similar page. Weighted lower than FAVICON_MATCH on purpose: a cheap
  // perceptual hash over a full page has a meaningfully higher false-positive/negative
  // rate than one over a small static icon, so it's corroborating evidence, not a
  // confirmed-clone gate.
  if (input.visualSimilarity) {
    events.push({ delta: 10, reason: "Website visually resembles the protected brand's real site", ruleCode: "VISUAL_SIMILARITY_MATCH" });
  }

  // A redesigned clone defeats favicon/visual matching but still has to call itself by
  // the brand's name to fool anyone (flyjambojetkenya.store: title "Fly JamboJet").
  // Spaces/hyphens are stripped so "Jambo Jet" and "Jambo-Jet" count too. Can fire on a
  // legitimate page that merely mentions the brand (a travel agent, a news article) --
  // which is why it's corroborating weight, not enough for high severity on its own.
  const pageNamesBrand = mentionsBrand(input.pageTitle, input.brandRoot) || mentionsBrand(input.pageText, input.brandRoot);
  if (pageNamesBrand) {
    events.push({ delta: 25, reason: "Website title or content uses the protected brand's name", ruleCode: "BRAND_NAME_ON_PAGE" });
  }

  // The brand takes payment through its own checkout, so a page using its name that asks
  // for money straight into an M-Pesa number or a wallet is a classic refund/booking scam.
  // Gated on the brand mention: plenty of unrelated shops show a till number.
  if (input.hasPaymentDestination && pageNamesBrand) {
    events.push({ delta: 15, reason: "Page uses the brand's name and asks for payment to an M-Pesa number or crypto wallet", ruleCode: "PAYMENT_DESTINATION" });
  }

  // Same phone/WhatsApp/paybill/wallet on two pages is the strongest "same operation"
  // signal there is -- but one page's extraction can be wrong, so it corroborates rather
  // than decides.
  if (input.sharedIndicator) {
    const { label, value, otherFindings } = input.sharedIndicator;
    events.push({
      delta: 20,
      reason: `Shares ${label} ${value} with ${otherFindings} other finding${otherFindings === 1 ? "" : "s"}`,
      ruleCode: "SHARED_INDICATOR",
    });
  }

  if (input.hasLoginForm) {
    events.push({ delta: 15, reason: "Login form detected on website", ruleCode: "LOGIN_FORM_DETECTED" });
  }

  if (input.hasPaymentForm) {
    events.push({ delta: 15, reason: "Payment-related form or language detected on website", ruleCode: "PAYMENT_FORM_DETECTED" });
  }

  if (input.looksParked) {
    events.push({ delta: -10, reason: "Site appears to be a parked/for-sale placeholder page, not active content", ruleCode: "PARKING_PAGE_DEDUCTION" });
  }

  if (input.isAllowlisted) {
    events.push({ delta: -40, reason: "Domain matches the brand's own registered/allowlisted domains", ruleCode: "OWN_DOMAIN_DEDUCTION" });
  }

  // App Store findings have no domain of their own to score against -- every one resolves
  // to the constant "apps.apple.com" hostname, so none of the domain-similarity/favicon/
  // visual-similarity rules above can ever fire for them. This is the actual signal:
  // confirmed at discovery time (appStoreMonitorJob.ts) that the listing's name/seller
  // contains the brand but isn't the known official publisher. Weighted high enough to
  // reach "high" severity alone -- a confirmed brand-name match on an app store listing is
  // a strong, purposeful signal on its own, unlike a single weak domain-similarity match
  // that needs corroborating evidence to matter.
  if (input.appStoreImpersonation) {
    events.push({
      delta: 60,
      reason: "App Store listing's name/seller matches the protected brand but isn't the known official publisher",
      ruleCode: "APP_STORE_IMPERSONATION",
    });
  }

  // Real people who were targeted. Corroborating, not deciding: a reporter can be wrong
  // (a legitimate travel agent looks like a scam to a nervous customer), so several
  // independent reports count for more than one.
  const reports = input.publicReportCount ?? 0;
  if (reports >= 3) {
    events.push({ delta: 25, reason: `Reported as a scam by ${reports} members of the public`, ruleCode: "PUBLIC_REPORT" });
  } else if (reports > 0) {
    events.push({ delta: 15, reason: `Reported as a scam by ${reports === 1 ? "a member" : `${reports} members`} of the public`, ruleCode: "PUBLIC_REPORT" });
  }

  // Someone already reported this exact URL as phishing (pipeline/phishFeedMonitorJob.ts)
  // AND it mentions the brand -- the feed match required that. High on its own, like
  // APP_STORE_IMPERSONATION. Worded "reported", not "confirmed": phishunt's terms forbid
  // asserting a listing is confirmed phishing on the feed's say-so alone.
  if (input.phishFeedListed) {
    events.push({ delta: 60, reason: "Reported as phishing by public threat feeds (phishunt.io)", ruleCode: "PHISH_FEED_LISTED" });
  }

  const rawScore = events.reduce((sum, e) => sum + e.delta, 0);
  const score = Math.max(0, Math.min(100, rawScore));

  return { score, severity: severityForScore(score), events };
}

// Name similarity, registration age and TLD -- facts about a registrable domain name.
function scoreDomainName(input: ScoringInput, events: ScoreEvent[]): void {
  const sld = input.domain.split(".")[0];
  const containsRootVerbatim = sld.includes(input.brandRoot) && sld !== input.brandRoot;
  // Plain Levenshtein ratio over the whole SLD under-scores brand+keyword concatenations
  // (e.g. "jambojet-secure-login" vs "jambojet" is a low character-level ratio despite
  // containing the exact brand name) -- treat a verbatim substring match as equivalent to
  // high similarity, since it's an even less ambiguous signal than a fuzzy typo.
  const similarity = containsRootVerbatim ? 1 : similarityRatio(sld, input.brandRoot);

  if (input.isHomoglyph) {
    events.push({ delta: 25, reason: "Homoglyph/confusable-character match to protected brand", ruleCode: "HOMOGLYPH_MATCH" });
  } else if (containsRootVerbatim) {
    events.push({ delta: 30, reason: "Protected brand name appears verbatim in the domain, combined with additional keywords", ruleCode: "DOMAIN_SIMILARITY_HIGH" });
  } else if (similarity >= 0.85) {
    events.push({ delta: 30, reason: `Domain strongly resembles protected brand (${Math.round(similarity * 100)}% similarity)`, ruleCode: "DOMAIN_SIMILARITY_HIGH" });
  } else if (similarity >= 0.6) {
    events.push({ delta: 15, reason: `Domain moderately resembles protected brand (${Math.round(similarity * 100)}% similarity)`, ruleCode: "DOMAIN_SIMILARITY_MEDIUM" });
  }

  if (input.registeredAt) {
    const ageMs = Date.now() - input.registeredAt.getTime();
    const hours = ageMs / (1000 * 60 * 60);
    if (hours < 24) {
      events.push({ delta: 30, reason: "Domain registered less than 24 hours ago", ruleCode: "DOMAIN_AGE_LT_24H" });
    } else if (hours < 24 * 7) {
      events.push({ delta: 20, reason: "Domain registered less than 7 days ago", ruleCode: "DOMAIN_AGE_LT_7D" });
    } else if (hours < 24 * 30) {
      // Phishing kits often go live a week or two after registration
      // (flyjambojetkenya.store: registered Sept 24, live clone found Oct 7).
      events.push({ delta: 10, reason: "Domain registered less than 30 days ago", ruleCode: "DOMAIN_AGE_LT_30D" });
    }
  }

  if (isHighRiskTld(input.domain)) {
    events.push({ delta: 10, reason: "Registered under a TLD with elevated abuse history", ruleCode: "HIGH_RISK_TLD" });
  }
}

// A social account is judged on what it calls itself and where it sends people: a page
// named like the brand that isn't one of its official accounts (fly.jambojet, FlyJambojetUG),
// and a phone/WhatsApp/M-Pesa number in its posts that isn't the brand's. Together they're
// the standard fake-booking pattern, which is why the pair reaches "high".
function scoreSocialAccount(social: NonNullable<ScoringInput["social"]>, events: ScoreEvent[]): void {
  if (social.handleImpersonation) {
    events.push({ delta: 40, reason: "Social account name resembles the protected brand but isn't one of its official accounts", ruleCode: "SOCIAL_HANDLE_IMPERSONATION" });
  }
  if (social.contactDetails) {
    events.push({ delta: 30, reason: "Posts give a phone, WhatsApp or payment number that isn't the brand's", ruleCode: "SOCIAL_CONTACT_DETAILS" });
  }
}
