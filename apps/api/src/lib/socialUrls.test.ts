import { describe, it, expect } from "vitest";
import { parseSocialUrl, normalizeHandle } from "./socialUrls";

describe("parseSocialUrl", () => {
  it("reduces a TikTok video to the account behind it", () => {
    // Found in the 2026-10-19 manual sweep, captioned with a non-official WhatsApp number.
    expect(parseSocialUrl("https://www.tiktok.com/@fly.jambojet/video/7523402938631392568")).toEqual({
      platform: "tiktok",
      handle: "fly.jambojet",
      profileUrl: "https://www.tiktok.com/@fly.jambojet",
    });
  });

  it("lowercases handles so one page can't become two findings", () => {
    expect(parseSocialUrl("https://www.facebook.com/FlyJambojetUG/")?.profileUrl).toBe("https://www.facebook.com/flyjambojetug");
    expect(parseSocialUrl("https://m.facebook.com/FlyJambojetUG/reviews/")?.profileUrl).toBe("https://www.facebook.com/flyjambojetug");
  });

  it("keys a numeric-id Facebook profile on the id", () => {
    expect(parseSocialUrl("https://www.facebook.com/profile.php?id=61551234567890")).toEqual({
      platform: "facebook",
      handle: null,
      profileUrl: "https://www.facebook.com/profile.php?id=61551234567890",
    });
    expect(parseSocialUrl("https://www.facebook.com/people/Jambojet-Offers/61551234567890/")?.profileUrl).toBe(
      "https://www.facebook.com/profile.php?id=61551234567890"
    );
  });

  it("ignores platform pages that aren't accounts", () => {
    expect(parseSocialUrl("https://www.facebook.com/watch/?v=123")).toBeNull();
    expect(parseSocialUrl("https://www.facebook.com/groups/123456")).toBeNull();
    expect(parseSocialUrl("https://www.tiktok.com/discover/jambo-jet-flights-nairobi-to-kitale")).toBeNull();
    expect(parseSocialUrl("https://x.com/search?q=jambojet")).toBeNull();
    expect(parseSocialUrl("https://www.youtube.com/watch?v=abc")).toBeNull();
  });

  it("takes an Instagram post's handle from the result title", () => {
    expect(parseSocialUrl("https://www.instagram.com/p/DAbc123/", "Jambojet Deals (@jambojet_deals) • Instagram photos")?.profileUrl).toBe(
      "https://www.instagram.com/jambojet_deals"
    );
    expect(parseSocialUrl("https://www.instagram.com/p/DAbc123/")).toBeNull();
    expect(parseSocialUrl("https://www.instagram.com/flyjambojet/")?.handle).toBe("flyjambojet");
  });

  it("handles X, Telegram and YouTube account links", () => {
    expect(parseSocialUrl("https://twitter.com/FlyJambojet/status/1")?.profileUrl).toBe("https://x.com/flyjambojet");
    expect(parseSocialUrl("https://t.me/s/jambojet_offers")?.profileUrl).toBe("https://t.me/jambojet_offers");
    // A private invite link has no public identity.
    expect(parseSocialUrl("https://t.me/+ASurUpHQ6z1mNWE0")).toBeNull();
    expect(parseSocialUrl("https://www.youtube.com/@fly.jambojet/videos")?.profileUrl).toBe("https://www.youtube.com/@fly.jambojet");
  });

  it("returns null for anything that isn't a social platform", () => {
    expect(parseSocialUrl("https://jambojetbooking.store/")).toBeNull();
    expect(parseSocialUrl("https://wa.me/254731880014")).toBeNull();
    expect(parseSocialUrl("not a url")).toBeNull();
  });
});

describe("normalizeHandle", () => {
  it("strips separators", () => {
    expect(normalizeHandle("Fly.Jambo_Jet-KE")).toBe("flyjambojetke");
  });
});
