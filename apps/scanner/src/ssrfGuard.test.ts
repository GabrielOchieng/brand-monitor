import { describe, it, expect } from "vitest";
import { isBlockedIp } from "./ssrfGuard";

describe("isBlockedIp", () => {
  it("blocks IPv4 loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.255.255.255")).toBe(true);
  });

  it("blocks IPv4 private ranges", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("192.168.1.1")).toBe(true);
  });

  it("does not treat 172.15.x.x or 172.32.x.x as private (just outside the /12 range)", () => {
    expect(isBlockedIp("172.15.255.255")).toBe(false);
    expect(isBlockedIp("172.32.0.0")).toBe(false);
  });

  it("blocks IPv4 link-local, including the cloud metadata address", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("169.254.0.1")).toBe(true);
  });

  it("blocks 0.0.0.0/8", () => {
    expect(isBlockedIp("0.0.0.0")).toBe(true);
  });

  it("does not block real public IPv4 addresses", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false); // example.com
  });

  it("blocks IPv6 loopback, unique-local, and link-local", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });

  it("does not block a real public IPv6 address", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false); // Cloudflare public DNS
  });
});
