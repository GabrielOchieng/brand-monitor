// Manual submission (Stage D) is the first place a user-controlled URL reaches this
// service -- prior to that, every URL came from an algorithmically-generated typosquat
// candidate that had already passed public DNS resolution. This check runs right before
// navigation (after resolving the hostname), not just as a string check on the URL, so a
// domain that only resolves to a private/internal IP at request time (DNS rebinding) is
// still caught.

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const BLOCKED_IPV4_RANGES = [
  "127.0.0.0/8", // loopback
  "10.0.0.0/8", // private
  "172.16.0.0/12", // private
  "192.168.0.0/16", // private
  "169.254.0.0/16", // link-local / cloud metadata (169.254.169.254)
  "0.0.0.0/8",
];

export function isBlockedIp(ip: string): boolean {
  if (ip.includes(":")) {
    // IPv6: block loopback, unique-local, and link-local.
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
  }
  return BLOCKED_IPV4_RANGES.some((cidr) => inCidr(ip, cidr));
}
