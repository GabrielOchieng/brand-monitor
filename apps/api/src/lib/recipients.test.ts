import { describe, it, expect } from "vitest";
import { deliveryRecipients, normalizeMatchValue, recipientProblems, resolveRouting, specificity, type ContactRule, type FindingFacts } from "./recipients";

const facts: FindingFacts = {
  domain: "jambojet-offers.co.ke",
  registrarName: "GoDaddy.com, LLC",
  registrarIanaId: "146",
  hostingOrg: "Cloudflare, Inc.",
  registrarAbuseEmail: "abuse@godaddy.com",
  hostingAbuseEmail: "abuse@cloudflare.com",
};

let n = 0;
function rule(p: Partial<ContactRule>): ContactRule {
  const r: ContactRule = {
    id: `r${++n}`,
    layer: "platform",
    channel: "registrar",
    matchType: "any",
    matchValue: "*",
    method: "email",
    emails: [],
    formUrl: null,
    instructions: null,
    language: null,
    enabled: true,
    ...p,
  };
  return { ...r, matchValue: normalizeMatchValue(r.matchType, r.matchValue) };
}

const own = ["jambojet.com"];

describe("resolveRouting", () => {
  it("falls back to the registry record when the contact book has nothing", () => {
    const r = resolveRouting("registrar", facts, [], null, own, []);
    expect(r).toMatchObject({ method: "email", to: ["abuse@godaddy.com"], source: { kind: "registry" } });
  });

  it("says so instead of guessing when nothing is known", () => {
    const r = resolveRouting("host", { ...facts, hostingAbuseEmail: null }, [], null, own, []);
    expect(r.method).toBe("none");
    expect(r.to).toEqual([]);
    expect(resolveRouting("cert", facts, [], null, own, []).why).toContain("No national CERT");
  });

  it("uses a web form when the contact book says the registrar only takes forms", () => {
    const r = resolveRouting("registrar", facts, [rule({ matchType: "name", matchValue: "GoDaddy", method: "form", formUrl: "https://godaddy.example/abuse" })], null, own, []);
    expect(r.method).toBe("form");
    expect(r.to).toEqual([]);
    expect(r.forms).toEqual([{ url: "https://godaddy.example/abuse", instructions: null }]);
    expect(r.why).toContain("platform contact book");
  });

  it("picks the most specific rule: IANA ID over name over TLD over any; the org wins a tie", () => {
    const rules = [
      rule({ matchType: "any", emails: ["any@x.example"] }),
      rule({ matchType: "tld", matchValue: ".co.ke", emails: ["tld@x.example"] }),
      rule({ matchType: "name", matchValue: "godaddy", emails: ["name@x.example"] }),
    ];
    expect(resolveRouting("registrar", facts, rules, null, own, []).to).toEqual(["name@x.example"]);
    const withIana = [...rules, rule({ matchType: "iana_id", matchValue: "146", emails: ["iana@x.example"] })];
    expect(resolveRouting("registrar", facts, withIana, null, own, []).to).toEqual(["iana@x.example"]);
    const tie = [...rules, rule({ layer: "org", matchType: "name", matchValue: "godaddy", emails: ["mine@x.example"] })];
    expect(resolveRouting("registrar", facts, tie, null, own, []).to).toEqual(["mine@x.example"]);
    expect(specificity(rule({ matchType: "tld", matchValue: "co.ke" }))).toBeGreaterThan(specificity(rule({ matchType: "tld", matchValue: "ke" })));
  });

  it("ignores disabled rules and rules for other channels", () => {
    const rules = [rule({ matchType: "any", emails: ["off@x.example"], enabled: false }), rule({ channel: "host", matchType: "any", emails: ["host@x.example"] })];
    expect(resolveRouting("registrar", facts, rules, null, own, []).to).toEqual(["abuse@godaddy.com"]);
  });

  it("skips a channel when a rule says so", () => {
    expect(resolveRouting("host", facts, [rule({ channel: "host", matchType: "name", matchValue: "cloudflare", method: "skip" })], null, own, []).method).toBe("skip");
  });

  it("lists every blocklist form", () => {
    const rules = [
      rule({ channel: "blocklist", method: "form", formUrl: "https://a.example/" }),
      rule({ channel: "blocklist", method: "form", formUrl: "https://b.example/" }),
    ];
    const r = resolveRouting("blocklist", facts, rules, null, own, []);
    expect(r.method).toBe("form");
    expect(r.forms.map((f) => f.url)).toEqual(["https://a.example/", "https://b.example/"]);
  });

  it("adds the channel's fixed recipients to email reports only", () => {
    const fixed = { to: ["extra@registrar-desk.example"], cc: ["legal@jambojet.com"], bcc: ["Archive@Jambojet.com"] };
    const r = resolveRouting("registrar", facts, [], fixed, own, []);
    expect(r.to).toEqual(["abuse@godaddy.com", "extra@registrar-desk.example"]);
    expect(r.cc).toEqual(["legal@jambojet.com"]); // own domain is fine as a copy
    expect(r.bcc).toEqual(["archive@jambojet.com"]);
    const form = resolveRouting("registrar", facts, [rule({ matchType: "name", matchValue: "godaddy", method: "form", formUrl: "https://g.example/" })], fixed, own, []);
    expect(form.cc).toEqual([]);
  });

  it("removes the org's own domains from To and blocked addresses everywhere", () => {
    const rules = [rule({ matchType: "any", emails: ["security@jambojet.com", "abuse@desk.example"] })];
    const r = resolveRouting("registrar", facts, rules, { to: [], cc: ["bounced@desk.example"], bcc: [] }, own, [{ value: "bounced@desk.example", expiresAt: null }]);
    expect(r.to).toEqual(["abuse@desk.example"]);
    expect(r.cc).toEqual([]);
    expect(r.removed).toEqual([
      { address: "security@jambojet.com", reason: "own_domain" },
      { address: "bounced@desk.example", reason: "blocked" },
    ]);
  });

  it("turns into a manual decision when every address is removed", () => {
    const r = resolveRouting("registrar", facts, [], null, own, [{ value: "@godaddy.com", expiresAt: null }]);
    expect(r.method).toBe("none");
    expect(r.why).toContain("manual decision");
  });
});

describe("recipientProblems", () => {
  const now = new Date("2026-11-27T00:00:00Z");
  it("matches a blocked domain and its subdomains, ignoring expired entries", () => {
    const blocked = [
      { value: "@spamtrap.example", expiresAt: null },
      { value: "old@desk.example", expiresAt: new Date("2026-11-01T00:00:00Z") },
    ];
    expect(recipientProblems({ to: ["a@mail.spamtrap.example", "old@desk.example"], cc: [], bcc: [] }, [], blocked, now)).toEqual([{ field: "to", address: "a@mail.spamtrap.example", reason: "blocked" }]);
  });
  it("flags own-domain addresses in To, including subdomains", () => {
    expect(recipientProblems({ to: ["x@mail.jambojet.com"], cc: ["y@jambojet.com"], bcc: [] }, own, [], now)).toEqual([{ field: "to", address: "x@mail.jambojet.com", reason: "own_domain" }]);
  });
});

describe("deliveryRecipients", () => {
  it("sends everything to the redirect address in redirect mode", () => {
    expect(deliveryRecipients({ to: ["a@x.example"], cc: ["b@x.example"], bcc: ["c@x.example"] }, "test@jambojet.com")).toEqual({ to: ["test@jambojet.com"], cc: [], bcc: [], redirected: true });
    expect(deliveryRecipients({ to: ["a@x.example"], cc: [], bcc: [] }, null)).toEqual({ to: ["a@x.example"], cc: [], bcc: [], redirected: false });
  });
});
