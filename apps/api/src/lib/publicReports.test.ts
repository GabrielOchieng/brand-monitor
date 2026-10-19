import { describe, it, expect } from "vitest";
import { PublicReportSchema, createRateLimiter, verifyTurnstile } from "./publicReports";
import { parseSubmittedUrl } from "./submittedUrl";

describe("PublicReportSchema", () => {
  it("needs a link or a phone number", () => {
    expect(PublicReportSchema.safeParse({ description: "they called me" }).success).toBe(false);
    expect(PublicReportSchema.safeParse({ phone: "0712345678" }).success).toBe(true);
    expect(PublicReportSchema.safeParse({ url: "jambojet-refund.site" }).success).toBe(true);
  });
  it("accepts an empty reporter email (the form sends one)", () => {
    expect(PublicReportSchema.safeParse({ phone: "0712345678", reporterEmail: "" }).success).toBe(true);
    expect(PublicReportSchema.safeParse({ phone: "0712345678", reporterEmail: "nope" }).success).toBe(false);
  });
});

describe("createRateLimiter", () => {
  it("allows `limit` hits per window per key, then blocks until the window passes", () => {
    const allow = createRateLimiter(2, 1000);
    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 10)).toBe(true);
    expect(allow("a", 20)).toBe(false);
    expect(allow("b", 20)).toBe(true);
    expect(allow("a", 1011)).toBe(true);
  });
});

describe("verifyTurnstile", () => {
  it("passes when no secret is configured (local dev / not set up yet)", async () => {
    expect(await verifyTurnstile(undefined, "1.2.3.4")).toBe(true);
  });
});

describe("parseSubmittedUrl", () => {
  it("splits bare domains from page URLs and blocks private hosts", () => {
    expect(parseSubmittedUrl("https://Jambojet-Refund.site/")).toMatchObject({ ok: true, type: "domain", identifier: "jambojet-refund.site" });
    expect(parseSubmittedUrl("https://facebook.com/jambojet.promo")).toMatchObject({ ok: true, type: "url" });
    expect(parseSubmittedUrl("http://192.168.1.1/")).toEqual({ ok: false, error: "target_not_allowed" });
    expect(parseSubmittedUrl("ftp://x.com")).toEqual({ ok: false, error: "invalid_url" });
  });
});
