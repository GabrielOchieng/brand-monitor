import { describe, expect, it } from "vitest";
import { buildTakedownKit, type KitInput } from "./takedownKit";

// jambo-jet.com as seen on 2026-11-20.
const jamboJet: KitInput = {
  finding: { identifier: "jambo-jet.com", type: "domain", firstDetectedAt: new Date("2026-11-19T08:00:00Z") },
  brand: { name: "Jambojet", primaryDomain: "jambojet.com" },
  domainIntel: {
    registrar: "NameCheap, Inc.",
    registeredAt: new Date("2026-11-01T00:00:00Z"),
    ip: "216.198.79.1",
    registrarAbuseEmail: "abuse@namecheap.com",
    hostingOrg: "Vercel, Inc",
    hostingAbuseEmail: "abuse@vercel.com",
  },
  websiteIntel: { title: "Jambojet | Book Flights in Kenya & East Africa" },
  socialIntel: null,
  reasons: ["Domain is 89% similar to the brand", "Payment-related form or language detected on website"],
  indicators: [
    { kind: "phone", value: "+254711024545" },
    { kind: "whatsapp", value: "+254711024545" },
    { kind: "whatsapp", value: "+254710492539" },
  ],
  screenshotUrl: "https://api.example/screenshots/abc.png",
};

const byKey = (input: KitInput) => Object.fromEntries(buildTakedownKit(input).map((c) => [c.key, c]));

describe("buildTakedownKit", () => {
  it("covers registrar, host, Safe Browsing, Safaricom, WhatsApp and KE-CIRT for a live scam domain", () => {
    const kit = byKey(jamboJet);
    expect(Object.keys(kit)).toEqual([
      "registrar",
      "hosting",
      "safe_browsing",
      "safaricom_333",
      "whatsapp_254711024545",
      "whatsapp_254710492539",
      "ke_cirt",
    ]);

    expect(kit.registrar.to).toBe("abuse@namecheap.com");
    expect(kit.registrar.openUrl).toMatch(/^mailto:abuse@namecheap\.com\?subject=/);
    expect(kit.registrar.body).toContain("clientHold");
    expect(kit.registrar.body).toContain("+254710492539");
    expect(kit.registrar.body).toContain("https://api.example/screenshots/abc.png");
    expect(kit.registrar.body).toContain("[Your name]\n[Your role], on behalf of Jambojet");

    // Vercel takes reports through its form, not email.
    expect(kit.hosting).toMatchObject({ kind: "form", openUrl: "https://vercel.com/abuse", trackerLabel: "Vercel (hosting)" });

    expect(kit.safe_browsing.openUrl).toBe("https://safebrowsing.google.com/safebrowsing/report_phish/?url=https%3A%2F%2Fjambo-jet.com");
    expect(kit.safaricom_333.body).toBe(
      "Fraud: +254711024545, +254710492539 are used by jambo-jet.com, a fake Jambojet website, to take money from customers."
    );
    expect(kit.whatsapp_254710492539.openUrl).toBe("https://wa.me/254710492539");
    expect(kit.ke_cirt.to).toBe("incidents@ke-cirt.go.ke");
  });

  it("points to ICANN Lookup when the registry gave no abuse contact, and emails an unknown host", () => {
    const kit = byKey({
      ...jamboJet,
      domainIntel: { ...jamboJet.domainIntel!, registrarAbuseEmail: null, hostingOrg: "Hetzner Online GmbH", hostingAbuseEmail: "abuse@hetzner.com" },
    });
    expect(kit.registrar.openUrl).toBe("https://lookup.icann.org/en/lookup?name=jambo-jet.com");
    expect(kit.hosting).toMatchObject({ kind: "email", to: "abuse@hetzner.com" });
  });

  it("skips the registrar for a URL finding on someone else's domain", () => {
    const kit = byKey({ ...jamboJet, finding: { ...jamboJet.finding, type: "url", identifier: "https://jambo-deals.vercel.app/book" } });
    expect(kit.registrar).toBeUndefined();
    expect(kit.safe_browsing.openUrl).toContain(encodeURIComponent("https://jambo-deals.vercel.app/book"));
  });

  it("only sends Kenyan mobile numbers to 333, and drops the mailto body when it is too long", () => {
    const kit = byKey({
      ...jamboJet,
      indicators: [{ kind: "phone", value: "+12025550123" }],
      reasons: Array.from({ length: 40 }, (_, i) => `A long, detailed reason number ${i} explaining exactly what we saw`),
    });
    expect(kit.safaricom_333).toBeUndefined();
    expect(kit.registrar.openUrl).toBe(`mailto:abuse@namecheap.com?subject=${encodeURIComponent("Fraud: jambo-jet.com is impersonating Jambojet")}`);
  });

  it("gives a social account the platform's impersonation report instead of registrar/host/Safe Browsing", () => {
    const kit = byKey({
      ...jamboJet,
      finding: { identifier: "https://www.tiktok.com/@jambojet72", type: "social", firstDetectedAt: new Date("2026-11-20T00:00:00Z") },
      domainIntel: null,
      websiteIntel: null,
      socialIntel: { platform: "tiktok", handle: "jambojet72", postUrl: null, title: "Jambojet pregnancy travel rules", snippet: null },
      indicators: [{ kind: "phone", value: "+254738566688" }],
    });
    expect(Object.keys(kit)).toEqual(["platform", "safaricom_333", "ke_cirt"]);
    expect(kit.platform).toMatchObject({ trackerLabel: "TikTok (impersonation)", openUrl: "https://www.tiktok.com/@jambojet72" });
    expect(kit.platform.body).toContain("@jambojet72");
  });
});
