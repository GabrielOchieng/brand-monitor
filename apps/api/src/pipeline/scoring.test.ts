import { describe, it, expect } from "vitest";
import { computeScore, type ScoringInput } from "./scoring";

const base: ScoringInput = {
  domain: "unrelated-example.com",
  brandRoot: "jambojet",
  isHomoglyph: false,
  registeredAt: null,
  faviconMatch: false,
  visualSimilarity: false,
  hasLoginForm: false,
  hasPaymentForm: false,
  looksParked: false,
  isAllowlisted: false,
};

function ruleCodes(input: ScoringInput): string[] {
  return computeScore(input).events.map((e) => e.ruleCode);
}

describe("computeScore", () => {
  it("scores a domain with no matching signals at 0/low", () => {
    const result = computeScore(base);
    expect(result.score).toBe(0);
    expect(result.severity).toBe("low");
    expect(result.events).toEqual([]);
  });

  it("fires HOMOGLYPH_MATCH for a homoglyph candidate, not the similarity rules", () => {
    const codes = ruleCodes({ ...base, domain: "jarnbojet.com", isHomoglyph: true });
    expect(codes).toContain("HOMOGLYPH_MATCH");
    expect(codes).not.toContain("DOMAIN_SIMILARITY_HIGH");
  });

  it("fires DOMAIN_SIMILARITY_HIGH when the brand name appears verbatim plus extra keywords", () => {
    const codes = ruleCodes({ ...base, domain: "flyjambojet.com" });
    expect(codes).toContain("DOMAIN_SIMILARITY_HIGH");
  });

  it("fires DOMAIN_SIMILARITY_MEDIUM for a moderately similar SLD that isn't a verbatim substring", () => {
    // "ajmbojet" (first two letters transposed) has a 0.75 Levenshtein similarity ratio
    // to "jambojet" and does NOT contain it as a substring, landing in the 0.6-0.85 band.
    const codes = ruleCodes({ ...base, domain: "ajmbojet.com" });
    expect(codes).toContain("DOMAIN_SIMILARITY_MEDIUM");
    expect(codes).not.toContain("DOMAIN_SIMILARITY_HIGH");
  });

  it("fires DOMAIN_AGE_LT_24H for a domain registered under a day ago", () => {
    const codes = ruleCodes({ ...base, registeredAt: new Date(Date.now() - 60 * 60 * 1000) });
    expect(codes).toContain("DOMAIN_AGE_LT_24H");
  });

  it("fires DOMAIN_AGE_LT_7D, not LT_24H, for a domain registered 3 days ago", () => {
    const codes = ruleCodes({ ...base, registeredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
    expect(codes).toContain("DOMAIN_AGE_LT_7D");
    expect(codes).not.toContain("DOMAIN_AGE_LT_24H");
  });

  it("does not fire any age rule for a domain registered long ago", () => {
    const codes = ruleCodes({ ...base, registeredAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) });
    expect(codes).not.toContain("DOMAIN_AGE_LT_24H");
    expect(codes).not.toContain("DOMAIN_AGE_LT_7D");
  });

  it("fires HIGH_RISK_TLD for a cheap/abused TLD", () => {
    expect(ruleCodes({ ...base, domain: "unrelated-example.xyz" })).toContain("HIGH_RISK_TLD");
  });

  it("fires FAVICON_MATCH and VISUAL_SIMILARITY_MATCH independently, weighted differently", () => {
    const favicon = computeScore({ ...base, faviconMatch: true });
    const visual = computeScore({ ...base, visualSimilarity: true });
    expect(favicon.events[0].ruleCode).toBe("FAVICON_MATCH");
    expect(visual.events[0].ruleCode).toBe("VISUAL_SIMILARITY_MATCH");
    expect(favicon.score).toBeGreaterThan(visual.score);
  });

  it("fires LOGIN_FORM_DETECTED and PAYMENT_FORM_DETECTED", () => {
    const codes = ruleCodes({ ...base, hasLoginForm: true, hasPaymentForm: true });
    expect(codes).toContain("LOGIN_FORM_DETECTED");
    expect(codes).toContain("PAYMENT_FORM_DETECTED");
  });

  it("applies a negative PARKING_PAGE_DEDUCTION", () => {
    const result = computeScore({ ...base, faviconMatch: true, looksParked: true });
    const deduction = result.events.find((e) => e.ruleCode === "PARKING_PAGE_DEDUCTION");
    expect(deduction?.delta).toBeLessThan(0);
  });

  it("applies a large negative OWN_DOMAIN_DEDUCTION that can offset other signals", () => {
    const result = computeScore({
      ...base,
      domain: "flyjambojet.com",
      faviconMatch: true,
      hasLoginForm: true,
      isAllowlisted: true,
    });
    expect(result.events.some((e) => e.ruleCode === "OWN_DOMAIN_DEDUCTION" && e.delta < 0)).toBe(true);
  });

  it("clamps the final score to [0, 100]", () => {
    const high = computeScore({
      ...base,
      domain: "flyjambojet.xyz",
      registeredAt: new Date(),
      faviconMatch: true,
      visualSimilarity: true,
      hasLoginForm: true,
      hasPaymentForm: true,
    });
    expect(high.score).toBeLessThanOrEqual(100);

    const low = computeScore({ ...base, looksParked: true, isAllowlisted: true });
    expect(low.score).toBeGreaterThanOrEqual(0);
  });

  it("maps score to severity consistently with severityForScore", () => {
    const critical = computeScore({
      ...base,
      domain: "flyjambojet.xyz",
      registeredAt: new Date(),
      faviconMatch: true,
      hasLoginForm: true,
    });
    expect(critical.severity).toBe("critical");

    const high = computeScore({ ...base, domain: "flyjambojet.xyz", registeredAt: new Date() });
    expect(high.severity).toBe("high");
  });
});
