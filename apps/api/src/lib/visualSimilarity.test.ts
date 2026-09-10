import { describe, it, expect } from "vitest";
import { regionalHashesMatch, serializeRegionalHashes, deserializeRegionalHashes } from "./visualSimilarity";

// computeRegionalHashes itself depends on sharp's native image decoding against a real
// screenshot buffer -- deliberately deferred (see project plan). The pure comparison/
// (de)serialization logic that actually decides a match is covered here.
function makeHashes(...bits: string[]): string[] {
  return bits;
}

describe("regionalHashesMatch", () => {
  it("matches two identical 16-region hash sets", () => {
    const hashes = Array.from({ length: 16 }, () => "10101010");
    expect(regionalHashesMatch(hashes, hashes)).toBe(true);
  });

  it("does not match when fewer than 11 of 16 regions are within the per-region threshold", () => {
    const a = Array.from({ length: 16 }, () => "00000000");
    // Flip every bit in 6 of the 16 regions (more than the 5-region slack: 16 - 11 = 5).
    const b = a.map((h, i) => (i < 6 ? "11111111" : h));
    expect(regionalHashesMatch(a, b)).toBe(false);
  });

  it("still matches when only a few regions (e.g. a banner) are corrupted", () => {
    const a = Array.from({ length: 16 }, () => "00000000");
    // Only 3 regions differ -- within the ~70% (11/16) matching-region requirement.
    const b = a.map((h, i) => (i < 3 ? "11111111" : h));
    expect(regionalHashesMatch(a, b)).toBe(true);
  });

  it("does not match hash sets of different lengths", () => {
    expect(regionalHashesMatch(makeHashes("1010"), makeHashes("1010", "1010"))).toBe(false);
  });

  it("does not match two empty hash sets", () => {
    expect(regionalHashesMatch([], [])).toBe(false);
  });
});

describe("serializeRegionalHashes / deserializeRegionalHashes", () => {
  it("round-trips a list of hashes through serialization", () => {
    const hashes = ["10101010", "01010101", "11110000"];
    expect(deserializeRegionalHashes(serializeRegionalHashes(hashes))).toEqual(hashes);
  });
});
