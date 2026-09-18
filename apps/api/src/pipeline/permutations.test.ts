import { describe, it, expect } from "vitest";
import { generateCandidates, isHighRiskTld } from "./permutations";

describe("generateCandidates", () => {
  const domains = (brandRoot: string, keywords: string[] = [], coreKeywords: string[] = []) =>
    new Set(generateCandidates(brandRoot, keywords, coreKeywords).map((c) => c.domain));

  it("generates the real jarnbojet homoglyph example (m -> rn)", () => {
    expect(domains("jambojet")).toContain("jarnbojet.com");
  });

  it("generates no-hyphen prefix concatenation (flyjambojet), not just suffix/hyphenated forms", () => {
    const d = domains("jambojet", ["fly"]);
    expect(d).toContain("flyjambojet.com");
    expect(d).toContain("fly-jambojet.com");
    expect(d).toContain("jambojet-fly.com");
    expect(d).toContain("jambojetfly.com");
  });

  it("checks concat-keyword candidates against the extended TLD list, including cheap/abused TLDs", () => {
    const d = domains("jambojet", ["book"]);
    expect(d).toContain("bookjambojet.site");
    expect(d).toContain("bookjambojet.online");
  });

  it("does not apply the extended TLD list to plain typo-technique candidates", () => {
    const c = generateCandidates("jambojet", []);
    const omission = c.find((x) => x.technique === "omission");
    expect(omission).toBeDefined();
    expect(c.some((x) => x.technique === "omission" && x.domain.endsWith(".site"))).toBe(false);
  });

  it("checks the exact, unmodified brand name across other TLDs (e.g. jambojet.site)", () => {
    const c = generateCandidates("jambojet", []);
    const altTld = c.find((x) => x.domain === "jambojet.site");
    expect(altTld?.technique).toBe("same_name_alt_tld");
  });

  it("also generates the real primary domain's own TLD here -- exclusion is discoveryJob.ts's allowlist job, not this function's", () => {
    const c = generateCandidates("jambojet", ["fly"]);
    expect(c.some((x) => x.domain === "jambojet.com" && x.technique === "same_name_alt_tld")).toBe(true);
  });

  it("marks homoglyph candidates as isHomoglyph", () => {
    const c = generateCandidates("jambojet", []);
    const homoglyph = c.find((x) => x.technique === "homoglyph");
    expect(homoglyph?.isHomoglyph).toBe(true);
  });

  it("deduplicates candidate SLDs that multiple techniques would otherwise produce twice", () => {
    const c = generateCandidates("jambojet", []);
    const slds = c.filter((x) => x.domain.endsWith(".com")).map((x) => x.domain);
    expect(new Set(slds).size).toBe(slds.length);
  });

  it("pairs core keywords with each other in both orders, matching real attacker compounds", () => {
    const d = domains("jambojet", ["fly", "book"], ["fly", "book"]);
    expect(d).toContain("bookflyjambojet.site");
    expect(d).toContain("flybookjambojet.online");
  });

  it("only checks core-keyword pairs against high-risk TLDs, not the full extended list", () => {
    const c = generateCandidates("jambojet", ["fly", "book"], ["fly", "book"]);
    const pairCandidates = c.filter((x) => x.technique === "brand_keyword_pair");
    expect(pairCandidates.length).toBeGreaterThan(0);
    expect(pairCandidates.some((x) => x.domain.endsWith(".org"))).toBe(false);
    expect(pairCandidates.some((x) => x.domain.endsWith(".site"))).toBe(true);
  });

  it("never pairs a plain concat keyword that isn't also passed as a core keyword", () => {
    const c = generateCandidates("jambojet", ["fly", "book", "support"], ["fly", "book"]);
    expect(c.some((x) => x.technique === "brand_keyword_pair" && x.domain.includes("support"))).toBe(false);
  });
});

describe("isHighRiskTld", () => {
  it("flags cheap/abused TLDs used by real attacker examples this session", () => {
    expect(isHighRiskTld("bookflyjambojet.site")).toBe(true);
    expect(isHighRiskTld("flyjambojet.online")).toBe(true);
    expect(isHighRiskTld("bookjambojet.club")).toBe(true);
  });

  it("does not flag ordinary TLDs", () => {
    expect(isHighRiskTld("jambojet.com")).toBe(false);
    expect(isHighRiskTld("jambojet.co.ke")).toBe(false);
  });
});
