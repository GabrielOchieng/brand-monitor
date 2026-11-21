import { describe, expect, it } from "vitest";
import { fetchHageziNrd, parseHageziLine } from "./hageziNrd";
import { brandMatcher } from "../pipeline/nrdMonitorJob";

const dataUrl = (text: string) => `data:text/plain;base64,${Buffer.from(text).toString("base64")}`;

describe("parseHageziLine", () => {
  it("keeps domains and drops comments and blanks", () => {
    expect(parseHageziLine("  JamboJetOnlineBooking.site \r")).toBe("jambojetonlinebooking.site");
    expect(parseHageziLine("# Title: NRD 7 days")).toBeNull();
    expect(parseHageziLine("! adblock comment")).toBeNull();
    expect(parseHageziLine("   ")).toBeNull();
  });
});

describe("fetchHageziNrd", () => {
  const list = "# header\nexample.com\njambojetonlinebooking.site\nflyjambojetdeals.online\nother.xyz\njambo-jet.com";
  const keep = brandMatcher("jambojet");

  it("streams the file and returns only matching domains", async () => {
    const r = await fetchHageziNrd(keep, [dataUrl(list)], 1);
    expect(r).toEqual({ status: "ok", lines: 5, matched: ["jambojetonlinebooking.site", "flyjambojetdeals.online", "jambo-jet.com"] });
  });

  it("matches the last line even without a trailing newline", async () => {
    const r = await fetchHageziNrd((d) => d === "jambo-jet.com", [dataUrl(list)], 1);
    expect(r.status === "ok" && r.matched).toEqual(["jambo-jet.com"]);
  });

  it("treats a suspiciously short file as a failure and tries the next URL", async () => {
    const r = await fetchHageziNrd(keep, [dataUrl("jambojet.shop"), dataUrl(list)], 3);
    expect(r.status).toBe("ok");
    const bad = await fetchHageziNrd(keep, [dataUrl("jambojet.shop")], 3);
    expect(bad.status).toBe("error");
  });
});
