import { describe, it, expect } from "vitest";
import { normalizeRegistrar } from "./correlation";

describe("normalizeRegistrar", () => {
  it("normalizes case, punctuation, and common corporate suffixes to the same string", () => {
    expect(normalizeRegistrar("NameCheap, Inc.")).toBe(normalizeRegistrar("NAMECHEAP INC"));
    expect(normalizeRegistrar("Namecheap.com, LLC")).not.toBe(normalizeRegistrar("NameCheap, Inc.")); // genuinely different registrar names, not expected to collapse
  });

  it("strips a trailing corporate suffix as a whole word only", () => {
    expect(normalizeRegistrar("GoDaddy.com, LLC")).toBe("godaddycom");
  });

  it("collapses repeated internal whitespace", () => {
    expect(normalizeRegistrar("Some   Registrar   Corp")).toBe("some registrar");
  });

  it("does not strip a suffix substring that isn't a whole word", () => {
    // "Incorporated" contains "inc" and "corp" as substrings but neither should be
    // stripped mid-word -- only whole-word matches of the known suffix list.
    expect(normalizeRegistrar("Incorporated Registrars")).toBe("incorporated registrars");
  });
});
