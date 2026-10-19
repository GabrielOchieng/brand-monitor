import { describe, it, expect } from "vitest";
import { classifySocialResult } from "./socialFindings";
import { isFactCheckAboutBrand, socialQueries } from "./socialSearchMonitorJob";

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
  it("runs three searches per brand", () => {
    expect(socialQueries("Jambojet")).toHaveLength(3);
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
