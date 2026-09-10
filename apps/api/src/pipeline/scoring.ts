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
  hasLoginForm: boolean;
  hasPaymentForm: boolean;
  looksParked: boolean;
  isAllowlisted: boolean;
}

export interface ScoringResult {
  score: number;
  severity: ReturnType<typeof severityForScore>;
  events: ScoreEvent[];
}

// Deterministic, additive, explainable -- every point traceable to a named rule.
// Reduced ruleset vs. the full ARCHITECTURE.md §6 model to match what the POC actually
// collects (no correlation/social signals yet).
export function computeScore(input: ScoringInput): ScoringResult {
  const events: ScoreEvent[] = [];
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
    }
  }

  if (isHighRiskTld(input.domain)) {
    events.push({ delta: 10, reason: "Registered under a TLD with elevated abuse history", ruleCode: "HIGH_RISK_TLD" });
  }

  if (input.faviconMatch) {
    events.push({ delta: 15, reason: "Website favicon matches the protected brand's favicon", ruleCode: "FAVICON_MATCH" });
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

  const rawScore = events.reduce((sum, e) => sum + e.delta, 0);
  const score = Math.max(0, Math.min(100, rawScore));

  return { score, severity: severityForScore(score), events };
}
