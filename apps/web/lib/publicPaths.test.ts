import { describe, expect, it } from "vitest";
import { isPublicPath } from "./publicPaths";

describe("isPublicPath", () => {
  // Regression: public in the middleware but not in the session provider, so it bounced to /login.
  it("includes the access-request form", () => {
    expect(isPublicPath("/request-access")).toBe(true);
  });

  it("includes the landing page, sign-in pages and scam-report links", () => {
    for (const p of ["/", "/login", "/forgot-password", "/reset-password", "/invite", "/confirm-email", "/report/abc123"]) expect(isPublicPath(p)).toBe(true);
  });

  it("excludes the console", () => {
    for (const p of ["/dashboard", "/threats", "/admin", "/admin/access-requests", "/report", "/loginx", null]) expect(isPublicPath(p)).toBe(false);
  });
});
