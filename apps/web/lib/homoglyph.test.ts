import { describe, expect, it } from "vitest";
import { suspiciousChars } from "./homoglyph";

describe("suspiciousChars", () => {
  it("marks a non-ASCII letter posing as a Latin one", () => {
    expect([...suspiciousChars("acmeaír-booking.com")]).toEqual([5]);
  });

  it("marks a Cyrillic letter", () => {
    expect([...suspiciousChars("аcmeair.com")]).toEqual([0]);
  });

  it("marks a digit between letters", () => {
    expect([...suspiciousChars("jamb0jet.com")]).toEqual([4]);
  });

  it("leaves digits that aren't between letters alone", () => {
    expect(suspiciousChars("flights2024.com").size).toBe(0);
    expect(suspiciousChars("203.0.113.24").size).toBe(0);
  });

  it("leaves a plain lookalike with no character tricks alone", () => {
    expect(suspiciousChars("acmeair-customercare.shop").size).toBe(0);
  });
});
