import { describe, it, expect } from "vitest";
import { accountDisplayName, classifySocialResult, nameResemblesBrand } from "./socialFindings";
import { isFactCheckAboutBrand, numberPivotQueries, socialQueries } from "./socialSearchMonitorJob";
import { parseSocialUrl } from "../lib/socialUrls";

// Jambojet's real official accounts (jambojet.com/official-channels, 2026-10-19).
const brand = {
  brandRoot: "jambojet",
  officialSocialUrls: [
    "https://www.facebook.com/flyjambojet",
    "https://www.instagram.com/flyjambojet",
    "https://x.com/flyjambojet",
    "https://www.tiktok.com/@flyjambojet",
    "https://www.youtube.com/@fly.jambojet",
    "https://wa.me/254740555333",
  ],
  ownKeys: new Set(["whatsapp:+254740555333", "phone:+254740555333"]),
  ownDomains: ["jambojet.com"],
};

describe("classifySocialResult", () => {
  it("flags a lookalike account that gives its own WhatsApp number (real result, 2026-10-19)", () => {
    const c = classifySocialResult(
      {
        url: "https://www.tiktok.com/@fly.jambojet/video/7523402938631392568",
        title: "Call or WhatsApp +254731880014 for Jambojet inquiries .",
        content: null,
      },
      brand
    );
    expect(c?.account.profileUrl).toBe("https://www.tiktok.com/@fly.jambojet");
    expect(c?.handleImpersonation).toBe(true);
    expect(c?.indicators).toEqual([{ kind: "phone", value: "+254731880014" }]);
  });

  it("flags a lookalike page name even without a number", () => {
    const c = classifySocialResult({ url: "https://www.facebook.com/FlyJambojetUG/", title: "Fly Jambojet", content: "Book now" }, brand);
    expect(c?.handleImpersonation).toBe(true);
    expect(c?.indicators).toEqual([]);
  });

  it("skips the brand's official accounts, whatever the link looks like", () => {
    expect(classifySocialResult({ url: "https://www.facebook.com/FlyJambojet/photos", title: "Fly Jambojet", content: "" }, brand)).toBeNull();
    expect(classifySocialResult({ url: "https://www.tiktok.com/@flyjambojet/video/7512088879692893445", title: "Jambojet", content: "" }, brand)).toBeNull();
  });

  it("skips a creator post that mentions the brand but shows no contact details", () => {
    expect(
      classifySocialResult(
        { url: "https://www.tiktok.com/@miss.millicent/video/7624618727077580040", title: "Here is how you book and pay for your flight. #jambojet", content: "" },
        brand
      )
    ).toBeNull();
  });

  it("flags a non-lookalike account posting a foreign number next to the brand name", () => {
    const c = classifySocialResult(
      { url: "https://www.facebook.com/cheapflightske/posts/1", title: "Jambojet tickets KSh 2,200", content: "WhatsApp 0712 345 678 to book" },
      brand
    );
    expect(c?.handleImpersonation).toBe(false);
    expect(c?.indicators).toEqual([{ kind: "phone", value: "+254712345678" }]);
  });

  it("doesn't count the brand's own WhatsApp number as a foreign contact", () => {
    expect(
      classifySocialResult({ url: "https://www.facebook.com/travelnewske/posts/2", title: "Jambojet", content: "Official line +254 740 555 333" }, brand)
    ).toBeNull();
  });

  it("ignores results that don't mention the brand at all", () => {
    expect(classifySocialResult({ url: "https://www.facebook.com/someshop/", title: "Shoes", content: "Call 0712345678" }, brand)).toBeNull();
  });
});

describe("social search wiring", () => {
  it("runs four brand searches, one of them in Swahili", () => {
    const queries = socialQueries("Jambojet");
    expect(queries).toHaveLength(4);
    expect(queries[3].query).toContain("tiketi");
  });

  it("rotates number searches, two a day, with the local form of Kenyan numbers", () => {
    const numbers = ["+254710492539", "+254738566688", "+254711024545"];
    const day0 = numberPivotQueries(numbers, new Date(0));
    expect(day0).toEqual([
      { number: "+254710492539", query: '"+254710492539" OR "0710492539"' },
      { number: "+254711024545", query: '"+254711024545" OR "0711024545"' },
    ]);
    const day1 = numberPivotQueries(numbers, new Date(86_400_000));
    expect(day1.map((q) => q.number)).toEqual(["+254738566688", "+254710492539"]);
    expect(numberPivotQueries(["+12025550123"], new Date(0))[0].query).toBe('"+12025550123"');
    expect(numberPivotQueries([], new Date(0))).toEqual([]);
  });

  it("only treats PesaCheck articles about the brand as fact-checks", () => {
    expect(
      isFactCheckAboutBrand(
        { url: "https://pesacheck.org/hoax-this-instagram-post-advertising-jambojet-tickets-sale-is-fraudulent/", title: "HOAX: This Instagram post advertising Jambojet tickets sale is fraudulent", content: "" },
        "jambojet"
      )
    ).toBe(true);
    expect(isFactCheckAboutBrand({ url: "https://pesacheck.org/some-other-hoax/", title: "HOAX: unrelated", content: "" }, "jambojet")).toBe(false);
    expect(isFactCheckAboutBrand({ url: "https://example.com/jambojet", title: "Jambojet", content: "" }, "jambojet")).toBe(false);
  });
});

describe("lookalike account names", () => {
  it("matches typo'd handles and display names, not unrelated names", () => {
    expect(nameResemblesBrand("jambotjet01235", "jambojet")).toBe(true); // one extra letter
    expect(nameResemblesBrand("Jambo Jet Airline", "jambojet")).toBe(true);
    expect(nameResemblesBrand("jamb0jet_ke", "jambojet")).toBe(true); // digit look-alike
    expect(nameResemblesBrand("jmabojet", "jambojet")).toBe(true); // swapped letters
    expect(nameResemblesBrand("Entai Tours & Travel", "jambojet")).toBe(false);
    expect(nameResemblesBrand("koleasafarispatra", "jambojet")).toBe(false);
    expect(nameResemblesBrand("Kenya Airports Authority PLC", "jambojet")).toBe(false);
  });

  it("reads the display name only where the title states it", () => {
    const ig = parseSocialUrl("https://www.instagram.com/reel/DfSozggxTiu", "Reel by Jambo Jet Airline (@jambotjet01235) · November 3, 2026")!;
    expect(accountDisplayName(ig, "Reel by Jambo Jet Airline (@jambotjet01235) · November 3, 2026", "https://www.instagram.com/reel/DfSozggxTiu")).toBe(
      "Jambo Jet Airline"
    );
    const fbPage = parseSocialUrl("https://www.facebook.com/FlyJambojetUG")!;
    expect(accountDisplayName(fbPage, "Fly Jambojet Uganda | Kampala - Facebook", "https://www.facebook.com/FlyJambojetUG")).toBe("Fly Jambojet Uganda");
    // A Facebook post's title is its text, not the poster's name.
    const fbPost = parseSocialUrl("https://www.facebook.com/sbmbankkenya/videos/x/1156329813485875")!;
    expect(accountDisplayName(fbPost, "SBM Bank x Jambojet: Win KES 4,000 Vouchers - Facebook", "https://www.facebook.com/sbmbankkenya/videos/x/1156329813485875")).toBeNull();
  });
});

describe("classifySocialResult with the 2026-11-20 live results", () => {
  it("flags the misspelled 'Jambo Jet Airline' account even though its number is the brand's own", () => {
    const withOwnNumber = { ...brand, ownKeys: new Set([...brand.ownKeys, "phone:+254719695535"]) };
    const hit = classifySocialResult(
      { url: "https://www.instagram.com/jambotjet01235", title: "Jambo Jet Airline (@jambotjet01235)", content: "Book now 0719695535" },
      withOwnNumber
    );
    expect(hit?.account.handle).toBe("jambotjet01235");
    expect(hit?.handleImpersonation).toBe(true);
    expect(hit?.indicators).toEqual([]);
  });

  it("still ignores news, complaint and sponsor posts about the brand", () => {
    for (const r of [
      { url: "https://www.facebook.com/eric.gardendayz/videos/jambo-jet-double-booking/4015457702084414", title: "Jambo Jet double booking embarrassment at Jomo Kenyatta ...", content: "" },
      { url: "https://www.facebook.com/sbmbankkenya/videos/now-boarding/1156329813485875", title: "SBM Bank x Jambojet: Win KES 4,000 Vouchers - Facebook", content: "" },
      { url: "https://www.tiktok.com/@koleasafarispatra/video/7703660721074113812", title: "Jambojet vs Kenya Airways: Things to Know for Your 2026 Holidays", content: "" },
    ]) {
      expect(classifySocialResult(r, brand)).toBeNull();
    }
  });

  it("accepts a number-search hit that shows the pivot number without naming the brand", () => {
    const result = { url: "https://www.tiktok.com/@cheapflights.ke/video/1", title: "Cheap flights Nairobi Mombasa", content: "Book on WhatsApp 0710 492 539" };
    expect(classifySocialResult(result, brand)).toBeNull();
    const hit = classifySocialResult(result, brand, new Set(["+254710492539"]));
    expect(hit?.indicators).toEqual([{ kind: "phone", value: "+254710492539" }]);
  });
});
