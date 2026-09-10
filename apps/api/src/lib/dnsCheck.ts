import { promises as dns } from "node:dns";

export interface DnsExistence {
  exists: boolean;
  a: string[];
  aaaa: string[];
  ns: string[];
  mx: string[];
}

async function safeResolve<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

// Gate for WHOIS/RDAP enrichment: any of A/AAAA/NS/MX existing means the domain is
// registered and delegated, even if nothing is hosted there yet (the "registered but
// dormant" case is the product's core early-detection value -- don't require a live
// website to consider a domain worth enriching).
export async function checkDnsExistence(domain: string): Promise<DnsExistence> {
  const [a, aaaa, ns, mx] = await Promise.all([
    safeResolve(() => dns.resolve4(domain)),
    safeResolve(() => dns.resolve6(domain)),
    safeResolve(() => dns.resolveNs(domain)),
    safeResolve(() => dns.resolveMx(domain).then((r) => r.map((m) => m.exchange))),
  ]);
  return { exists: a.length + aaaa.length + ns.length + mx.length > 0, a, aaaa, ns, mx };
}
