import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { unzipSingleFile, nrdUrl } from "./nrdFeed";
import { brandMatcher } from "../pipeline/nrdMonitorJob";

// Builds a one-entry zip the way whoisds ships it (deflated), with sizes only in the
// central directory -- the case a local-header-only reader gets wrong.
function makeZip(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content));
  const fname = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(fname.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(content.length, 24);
  cd.writeUInt16LE(fname.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdOffset = local.length + fname.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + fname.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, fname, data, cd, fname, eocd]);
}

describe("unzipSingleFile", () => {
  it("extracts a deflated entry using central-directory sizes", () => {
    const text = "a.com\nflyjambojetkenya.store\n";
    expect(unzipSingleFile(makeZip("domain-names.txt", text)).toString()).toBe(text);
  });

  it("rejects non-zip input", () => {
    expect(() => unzipSingleFile(Buffer.from("<html></html>"))).toThrow();
  });
});

describe("nrdUrl", () => {
  it("encodes the date the way whoisds's own download links do", () => {
    expect(nrdUrl("2026-10-06")).toBe("https://www.whoisds.com/whois-database/newly-registered-domains/MjAyNi0xMC0wNi56aXA=/nrd");
  });
});

describe("brandMatcher", () => {
  const m = brandMatcher("jambojet");
  it("matches the brand and its misspellings anywhere in the name", () => {
    expect(m("flyjambojetkenya.store")).toBe(true);
    expect(m("jarnbojet-login.com")).toBe(true);
  });
  it("ignores short fragments that match unrelated names", () => {
    expect(m("jamboreekindy.com.au")).toBe(false);
  });
});
