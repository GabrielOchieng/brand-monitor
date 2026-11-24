import { randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  CHANNEL_KINDS,
  CHANNELS,
  defang,
  defaultTemplate,
  DEFAULT_TEMPLATES,
  newReportRef,
  renderTemplate,
  validateTemplate,
  type ReportContext,
} from "./reportTemplates";
import { channelsFor, screenshotFileOf } from "./reportContext";
import { registrarIanaIdOf } from "./rdap";

const ctx: ReportContext = {
  finding: { url: "https://jambojet-support.com/login", domain: "jambojet-support.com", firstDetectedAt: new Date("2026-11-20T08:30:00Z") },
  brand: { name: "Jambojet", officialDomain: "jambojet.com" },
  registrar: { name: "Name.com, Inc.", ianaId: "625" },
  registeredAt: new Date("2026-11-18T00:00:00Z"),
  nameservers: ["ns1.example.net", "ns2.example.net"],
  ip: "203.0.113.5",
  hostingOrg: "Example Hosting",
  lastChecked: { at: new Date("2026-11-24T09:00:00Z"), live: true },
  // Attacker-controlled text must never be read as a placeholder.
  reasons: ["Page title is \"{{signature}} Jambojet login\"", "Has a login form"],
  indicators: [{ kind: "mpesa_paybill", value: "123456" }],
  screenshotUrl: "https://api.example/screenshots/f1.png",
  org: { name: "Jambojet Ltd", details: "Jambojet Ltd, Nairobi", disclaimer: null },
  signature: "Brand Protection Team",
  signatory: { name: "A. Person", title: "Head of Legal", email: "legal@jambojet.example" },
  reportRef: "BM-7KQ2X9TD",
  previous: null,
};

describe("built-in templates", () => {
  it("exist for every channel and kind, and pass validation", () => {
    for (const channel of CHANNELS) {
      for (const kind of CHANNEL_KINDS[channel]) {
        expect(DEFAULT_TEMPLATES[`${channel}.${kind}`], `${channel}.${kind}`).toBeDefined();
        expect(validateTemplate(defaultTemplate(channel, kind), channel), `${channel}.${kind}`).toEqual([]);
      }
    }
  });
});

describe("validateTemplate", () => {
  const ok = { subject: "{{reportRef}} Fraud on {{domain.defanged}}", body: "Hi\n\n{{evidence}}\n\n{{signature}}" };
  it("accepts a minimal valid template", () => expect(validateTemplate(ok, "registrar")).toEqual([]));
  it("requires the locked blocks exactly once", () => {
    expect(validateTemplate({ ...ok, subject: "Fraud" }, "registrar")).toContain("The subject must contain {{reportRef}} exactly once.");
    expect(validateTemplate({ ...ok, body: "{{evidence}}" }, "host")).toContain("The body must contain {{signature}} exactly once.");
    expect(validateTemplate({ ...ok, body: "{{evidence}} {{evidence}} {{signature}}" }, "host")).toContain("The body must contain {{evidence}} exactly once.");
  });
  it("lets web-form text skip the subject tag and signature", () => {
    expect(validateTemplate({ subject: "", body: "{{evidence}}" }, "blocklist")).toEqual([]);
  });
  it("rejects unknown placeholders, stray braces, blocks in the subject and multi-line subjects", () => {
    expect(validateTemplate({ ...ok, body: ok.body + " {{registrar.email}}" }, "registrar")).toContain("Unknown placeholder {{registrar.email}}.");
    expect(validateTemplate({ ...ok, body: ok.body + " {{ oops" }, "registrar")).toContain("There are {{ or }} that aren't part of a placeholder.");
    expect(validateTemplate({ ...ok, subject: "{{reportRef}} {{evidence}}" }, "registrar")).toContain("{{evidence}} is a block of several lines and can't go in the subject.");
    expect(validateTemplate({ ...ok, subject: "{{reportRef}}\nx" }, "registrar")).toContain("The subject must be one line.");
  });
});

describe("renderTemplate", () => {
  it("fills in the registrar report with the evidence an abuse desk needs", () => {
    const r = renderTemplate(defaultTemplate("registrar", "first"), ctx);
    expect(r.subject).toBe("[BM-7KQ2X9TD] Fraud: jambojet-support[.]com impersonates Jambojet");
    expect(r.body).toContain("Hello Name.com, Inc. abuse team,");
    expect(r.body).toContain("Reported site: https://jambojet-support.com/login");
    expect(r.body).toContain("- Registrar: Name.com, Inc. (IANA ID 625)");
    expect(r.body).toContain("- Nameservers: ns1.example.net, ns2.example.net");
    expect(r.body).toContain("- First seen by our monitoring: 2026-11-20 08:30 UTC");
    expect(r.body).toContain("- Last checked: 2026-11-24 09:00 UTC (site live)");
    expect(r.body).toContain("- M-Pesa paybill: 123456");
    expect(r.body).toContain("authorized by A. Person, Head of Legal (legal@jambojet.example)");
    expect(r.body).toContain("Jambojet Ltd, Nairobi");
    expect(r.body).not.toMatch(/\n{3,}/);
    expect(r.body.endsWith("Jambojet Ltd, Nairobi")).toBe(true); // empty disclaimer leaves no trailing gap
  });

  it("never expands placeholders that arrive inside finding data", () => {
    const r = renderTemplate(defaultTemplate("registrar", "first"), ctx);
    expect(r.body).toContain('Page title is "{{signature}} Jambojet login"');
    expect(r.body.match(/Brand Protection Team/g)?.length).toBe(1);
  });

  it("says what's missing instead of leaving gaps", () => {
    const r = renderTemplate(defaultTemplate("host", "first"), { ...ctx, signature: null, signatory: null, hostingOrg: null });
    expect(r.body).toContain("Hello hosting provider abuse team,");
    expect(r.body).toContain("[No signature yet");
  });
});

describe("helpers", () => {
  it("defangs a domain", () => expect(defang("a.b.example.com")).toBe("a[.]b[.]example[.]com"));
  it("makes BM- references without look-alike characters", () => {
    const ref = newReportRef(randomBytes);
    expect(ref).toMatch(/^BM-[2-9A-HJKMNP-Z]{8}$/);
  });
  it("reads the registrar IANA ID from RDAP", () => {
    expect(registrarIanaIdOf({ roles: ["registrar"], handle: "625" })).toBe("625");
    expect(registrarIanaIdOf({ roles: ["registrar"], handle: "X-1", publicIds: [{ type: "IANA Registrar ID", identifier: "1068" }] })).toBe("1068");
    expect(registrarIanaIdOf({ roles: ["registrar"], handle: "GODADDY-REG" })).toBeNull();
    expect(registrarIanaIdOf(undefined)).toBeNull();
  });
  it("only accepts real screenshot paths", () => {
    expect(screenshotFileOf("/screenshots/cmabc123.png")).toBe("cmabc123.png");
    expect(screenshotFileOf("/screenshots/../etc/passwd")).toBeNull();
  });
  it("offers no channels for social findings and no registrar for URL findings", () => {
    expect(channelsFor("social")).toEqual([]);
    expect(channelsFor("url")).not.toContain("registrar");
    expect(channelsFor("domain")).toContain("registrar");
  });
});
