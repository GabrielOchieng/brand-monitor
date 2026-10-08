import { describe, it, expect } from "vitest";
import { normalizeStatusCode, isOnHold, parseRdapDomain, parseRdapIp } from "./rdap";

// Trimmed from the real rdap.publicinterestregistry.org response for flyjambojet.org (2026-10-08).
const pirDomain = {
  ldhName: "flyjambojet.org",
  status: ["client transfer prohibited"],
  events: [
    { eventAction: "expiration", eventDate: "2027-09-07T16:11:39.192Z" },
    { eventAction: "registration", eventDate: "2026-09-07T16:11:39.192Z" },
    { eventAction: "last changed", eventDate: "2026-09-12T16:12:23.508Z" },
    { eventAction: "last update of RDAP database", eventDate: "2026-10-08T09:05:43.801Z" },
  ],
  entities: [
    {
      roles: ["registrar"],
      handle: "625",
      vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Name.com, Inc."]]],
      entities: [
        {
          roles: ["abuse"],
          vcardArray: [
            "vcard",
            [
              ["version", {}, "text", "4.0"],
              ["tel", { type: "voice" }, "uri", "tel:+1.7203101849"],
              ["email", {}, "text", "abuse@name.com"],
            ],
          ],
        },
      ],
    },
  ],
  nameservers: [{ ldhName: "ns1cny.name.com" }, { ldhName: "ns2ckr.name.com" }],
};

// Trimmed from the real rdap.arin.net response for 34.111.179.208.
const arinIp = {
  name: "GOOGL-2",
  entities: [
    {
      roles: ["registrant"],
      vcardArray: ["vcard", [["fn", {}, "text", "Google LLC"]]],
      entities: [
        { roles: ["noc", "abuse"], vcardArray: ["vcard", [["email", {}, "text", "google-cloud-compliance@google.com"]]] },
        { roles: ["technical", "administrative"], vcardArray: ["vcard", [["email", {}, "text", "arin-contact@google.com"]]] },
      ],
    },
  ],
};

describe("normalizeStatusCode", () => {
  it("maps RDAP and WHOIS spellings to the same EPP code", () => {
    expect(normalizeStatusCode("client transfer prohibited")).toBe("clientTransferProhibited");
    expect(normalizeStatusCode("clientTransferProhibited https://icann.org/epp#clientTransferProhibited")).toBe("clientTransferProhibited");
    expect(normalizeStatusCode("client hold")).toBe("clientHold");
    expect(normalizeStatusCode("serverHold (https://icann.org/epp#serverHold)")).toBe("serverHold");
    expect(normalizeStatusCode("active")).toBe("ok");
  });

  it("detects a hold", () => {
    expect(isOnHold(["clientHold"])).toBe(true);
    expect(isOnHold(["serverHold", "clientTransferProhibited"])).toBe(true);
    expect(isOnHold(["clientTransferProhibited"])).toBe(false);
  });
});

describe("parseRdapDomain", () => {
  it("extracts registry dates, status and the registrar abuse contact", () => {
    const info = parseRdapDomain(pirDomain);
    expect(info).toMatchObject({
      registrar: "Name.com, Inc.",
      registeredAt: "2026-09-07T16:11:39.192Z",
      lastChangedAt: "2026-09-12T16:12:23.508Z",
      expiresAt: "2027-09-07T16:11:39.192Z",
      statusCodes: ["clientTransferProhibited"],
      registrarAbuseEmail: "abuse@name.com",
      registrarAbusePhone: "+1.7203101849",
      nameservers: ["ns1cny.name.com", "ns2ckr.name.com"],
      source: "rdap",
    });
  });
});

describe("parseRdapIp", () => {
  it("finds the network owner and its abuse contact", () => {
    expect(parseRdapIp(arinIp)).toEqual({ org: "Google LLC", abuseEmail: "google-cloud-compliance@google.com" });
  });

  it("finds an abuse contact listed as a sibling entity (RIPE/AFRINIC layout)", () => {
    const ripe = {
      name: "EXAMPLE-NET",
      entities: [
        { roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Example Hosting Ltd"]]] },
        { roles: ["abuse"], vcardArray: ["vcard", [["email", {}, "text", "abuse@example-hosting.test"]]] },
      ],
    };
    expect(parseRdapIp(ripe)).toEqual({ org: "Example Hosting Ltd", abuseEmail: "abuse@example-hosting.test" });
  });
});
