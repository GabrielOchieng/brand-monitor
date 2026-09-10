import { describe, it, expect } from "vitest";
import { levenshteinDistance, similarityRatio } from "./levenshtein";

describe("levenshteinDistance", () => {
  it("is 0 for identical strings", () => {
    expect(levenshteinDistance("jambojet", "jambojet")).toBe(0);
  });

  it("equals the length of the other string when one side is empty", () => {
    expect(levenshteinDistance("", "jambojet")).toBe(8);
    expect(levenshteinDistance("jambojet", "")).toBe(8);
  });

  it("counts a single substitution as distance 1", () => {
    expect(levenshteinDistance("jambojet", "jambojot")).toBe(1);
  });

  it("counts an adjacent transposition as distance 2 (plain Levenshtein, not Damerau)", () => {
    expect(levenshteinDistance("jambojet", "ajmbojet")).toBe(2);
  });
});

describe("similarityRatio", () => {
  it("is 1 for identical strings", () => {
    expect(similarityRatio("jambojet", "jambojet")).toBe(1);
  });

  it("is 1 for two empty strings", () => {
    expect(similarityRatio("", "")).toBe(1);
  });

  it("is 0 for completely different strings of the same length", () => {
    expect(similarityRatio("aaaa", "zzzz")).toBe(0);
  });

  it("matches the ratio used by scoring.ts's medium-similarity band", () => {
    expect(similarityRatio("ajmbojet", "jambojet")).toBe(0.75);
  });
});
