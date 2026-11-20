import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { addressBarSvg, captureLabel, fitUrl, withAddressBar } from "./addressBar";

describe("address bar", () => {
  it("adds a 48px bar above a 1280px screenshot and keeps the page below it", async () => {
    const page = await sharp({ create: { width: 1280, height: 800, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const out = await withAddressBar(page, "https://www.jambo-jet.com/", new Date("2026-11-20T11:21:00Z"));
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1280, 848]);
    // The page itself is untouched: the first row under the bar is still the page's red.
    const { data } = await sharp(out).extract({ left: 640, top: 48, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([255, 0, 0]);
  });

  it("escapes the URL and states the capture time in UTC", () => {
    const svg = addressBarSvg('https://evil.example/?a=1&b=<script>"', new Date("2026-11-20T11:21:00Z"), 1280);
    expect(svg).toContain("a=1&amp;b=&lt;script&gt;&quot;");
    expect(svg).not.toContain("<script>");
    expect(captureLabel(new Date("2026-11-20T11:21:59Z"))).toBe("Captured 2026-11-20 11:21 UTC");
  });

  it("shortens long URLs from the end, keeping the host", () => {
    expect(fitUrl("https://www.jambo-jet.com/", 80)).toBe("https://www.jambo-jet.com/");
    const long = fitUrl(`https://www.jambo-jet.com/${"x".repeat(200)}`, 60);
    expect(long).toHaveLength(60);
    expect(long.startsWith("https://www.jambo-jet.com/")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
  });
});
