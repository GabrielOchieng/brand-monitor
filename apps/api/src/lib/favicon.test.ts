import { describe, it, expect } from "vitest";
import { hammingDistance, FAVICON_MATCH_THRESHOLD } from "./favicon";

// computeAverageHash/computeFaviconHash/fetchFaviconHash all depend on sharp's native
// image decoding or a real network fetch -- deliberately deferred (see project plan),
// not covered here. hammingDistance is pure string comparison and the actual match
// decision point (compared against FAVICON_MATCH_THRESHOLD elsewhere).
describe("hammingDistance", () => {
  it("is 0 for identical hashes", () => {
    expect(hammingDistance("10101010", "10101010")).toBe(0);
  });

  it("counts the number of differing bit positions", () => {
    expect(hammingDistance("1111", "1100")).toBe(2);
  });

  it("treats a length mismatch as the maximum possible distance rather than comparing a truncated prefix", () => {
    expect(hammingDistance("1111", "11")).toBe(4);
  });

  it("is consistent with FAVICON_MATCH_THRESHOLD as an inclusive match boundary", () => {
    const a = "1".repeat(64);
    const b = "0".repeat(FAVICON_MATCH_THRESHOLD) + "1".repeat(64 - FAVICON_MATCH_THRESHOLD);
    expect(hammingDistance(a, b)).toBe(FAVICON_MATCH_THRESHOLD);
  });
});
