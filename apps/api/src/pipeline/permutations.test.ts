import { describe, it, expect } from "vitest";
import { generateCandidates, isHighRiskTld } from "./permutations";

describe("generateCandidates", () => {
  const domains = (brandRoot: string, keywords: string[] = []) =>
    new Set(generateCandidates(brandRoot, keywords).map((c) => c.domain));

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

  it("never generates the exact brand root itself as a candidate", () => {
    const c = generateCandidates("jambojet", ["fly"]);
    expect(c.some((x) => x.domain === "jambojet.com")).toBe(false);
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
