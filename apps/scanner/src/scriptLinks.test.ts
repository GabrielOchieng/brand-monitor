import { describe, expect, it } from "vitest";
import { extractScriptLinks, isFirstPartyScript } from "./scriptLinks";

describe("extractScriptLinks", () => {
  it("finds the WhatsApp link a booking flow builds on click (jambo-jet.com, 2026-11-20)", () => {
    const bundle =
      '"_Thank you for flying Jambojet! #NowYouCanFly_"].join(`\n`),qt=`https://wa.me/254710492539?text=${encodeURIComponent(fe)}`;window.open(qt,"_blank")';
    expect(extractScriptLinks([bundle])).toEqual(["wa.me/254710492539"]);
  });

  it("finds api.whatsapp.com, Telegram and tel: links", () => {
    const js = 'a="https://api.whatsapp.com/send?phone=254700000001&text=hi";b="https://t.me/jambo_support";c="tel:+254 700 000 002"';
    expect(extractScriptLinks([js])).toEqual([
      "api.whatsapp.com/send?phone=254700000001",
      "t.me/jambo_support",
      "tel:+254 700 000 002",
    ]);
  });

  it("ignores bare digit runs and links without a number", () => {
    const js = 'price=254710492539;share=`https://wa.me/?text=${t}`;flight="JM813777";x=`https://wa.me/${num}`';
    expect(extractScriptLinks([js])).toEqual([]);
  });
});

describe("isFirstPartyScript", () => {
  it("accepts the page's own host, its www/apex twin and subdomains", () => {
    const hosts = ["jambo-jet.com", "www.jambo-jet.com"];
    expect(isFirstPartyScript("https://www.jambo-jet.com/assets/index.js", hosts)).toBe(true);
    expect(isFirstPartyScript("https://cdn.jambo-jet.com/a.js", hosts)).toBe(true);
    expect(isFirstPartyScript("https://jambo-jet.com/a.js", ["www.jambo-jet.com"])).toBe(true);
  });

  it("rejects third-party scripts", () => {
    expect(isFirstPartyScript("https://www.googletagmanager.com/gtag/js", ["jambo-jet.com"])).toBe(false);
    expect(isFirstPartyScript("https://notjambo-jet.com/a.js", ["jambo-jet.com"])).toBe(false);
  });
});
