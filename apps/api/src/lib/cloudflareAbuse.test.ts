import { describe, it, expect } from "vitest";
import { CloudflareConfigSchema, isCloudflareHost, phishingReportBody } from "./cloudflareAbuse";
import { resolveRouting } from "./recipients";

const cfg = CloudflareConfigSchema.parse({
  accountId: "0123456789abcdef0123456789abcdef",
  apiToken: "x".repeat(40),
  name: "Brand Protection",
  email: "BrandProtection@Example.com",
});

describe("phishingReportBody", () => {
  it("fills Cloudflare's phishing fields, reporter anonymous to the site owner by default", () => {
    const b = phishingReportBody(cfg, { urls: ["https://fake.example/login", "https://fake.example/login"], justification: "A".repeat(30), comments: "ref" });
    expect(b).toMatchObject({
      act: "abuse_phishing",
      email: "brandprotection@example.com",
      email2: "brandprotection@example.com",
      name: "Brand Protection",
      host_notification: "send",
      owner_notification: "send-anon",
      urls: "https://fake.example/login",
      comments: "ref",
    });
    expect(b).not.toHaveProperty("company");
  });
  it("keeps the justification within 20-5000 characters", () => {
    expect(phishingReportBody(cfg, { urls: ["https://x.example"], justification: "short" }).justification.length).toBeGreaterThanOrEqual(20);
    expect(phishingReportBody(cfg, { urls: ["https://x.example"], justification: "y".repeat(9000) }).justification.length).toBeLessThanOrEqual(5000);
  });
  it("validates the account ID", () => {
    expect(CloudflareConfigSchema.safeParse({ ...cfg, accountId: "nope" }).success).toBe(false);
  });
});

describe("Cloudflare routing", () => {
  const facts = { domain: "fake.example", registrarName: null, registrarIanaId: null, hostingOrg: "Cloudflare, Inc.", registrarAbuseEmail: null, hostingAbuseEmail: "abuse@cloudflare.com" };
  it("recognises Cloudflare as the host", () => {
    expect(isCloudflareHost("CLOUDFLARENET")).toBe(true);
    expect(isCloudflareHost("Amazon.com, Inc.")).toBe(false);
  });
  it("uses the API only when it's connected, and only for the host channel", () => {
    expect(resolveRouting("host", facts, [], null, [], [], new Date(), ["cloudflare"])).toMatchObject({ method: "api", apiProvider: "cloudflare", to: [] });
    expect(resolveRouting("host", facts, [], null, [], [], new Date(), []).method).toBe("email");
    expect(resolveRouting("registrar", facts, [], null, [], [], new Date(), ["cloudflare"]).method).not.toBe("api");
  });
});
