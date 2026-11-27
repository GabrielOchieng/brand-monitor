import { describe, expect, it } from "vitest";
import { turnstileFailureKind } from "./turnstileErrors";

describe("turnstileFailureKind", () => {
  // 110200: the site key wasn't allowed on brand-monitor.gabrielochieng.com (2026-11-27).
  it("reads the 110xxx codes as our setup", () => {
    for (const code of ["110200", 110100, "110110"]) expect(turnstileFailureKind(code)).toBe("config");
  });

  it("reads anything else as something on the visitor's side", () => {
    for (const code of ["200500", "300010", "600010", undefined, ""]) expect(turnstileFailureKind(code)).toBe("blocked");
  });
});
