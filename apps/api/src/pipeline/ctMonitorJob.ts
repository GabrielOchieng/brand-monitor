import { withTenant } from "../lib/tenant";
import { queryCtLog } from "../lib/ctLog";
import { checkDnsExistence } from "../lib/dnsCheck";

export interface CtMonitorJobData {
  brandId: string;
  organizationId: string;
}

// Complementary to discoveryJob.ts, not a replacement -- that one guesses plausible names
// and DNS-checks them; this one searches real, publicly-logged certificate issuances for
// anything containing the brand name, catching squats regardless of what naming pattern
// they follow. See lib/ctLog.ts for why crt.sh (pull) was chosen over CertStream (a
// persistent firehose connection this app's architecture and RAM budget don't fit).
export async function runCtMonitorJob(data: CtMonitorJobData): Promise<void> {
  const { brandId, organizationId } = data;

  const brand = await withTenant(organizationId, (tx) =>
    tx.brand.findUniqueOrThrow({ where: { id: brandId }, include: { domains: true } })
  );

  const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();
  const ownDomains = [brand.primaryDomain.toLowerCase(), ...brand.domains.map((d) => d.domain.toLowerCase())];
  const isOwnDomain = (host: string) => ownDomains.some((d) => host === d || host.endsWith(`.${d}`));

  const hostnames = await queryCtLog(brandRoot);
  if (hostnames === null) return; // crt.sh unreachable this round -- next scheduled tick retries

  for (const hostname of hostnames) {
    // Defensive re-check: one crt.sh row's name_value can bundle unrelated SANs alongside
    // the real match (a multi-domain cert) -- ctLog.ts already splits per-line, but this
    // guards against any line that slipped through without actually containing the brand.
    if (!hostname.includes(brandRoot)) continue;
    if (isOwnDomain(hostname)) continue;

    await withTenant(organizationId, async (tx) => {
      const existing = await tx.finding.findUnique({ where: { brandId_identifier: { brandId, identifier: hostname } } });
      if (existing) return;

      // Deliberately created regardless of current DNS resolution, unlike
      // discoveryJob.ts's guessed candidates -- a real, publicly-logged certificate
      // issuance is itself stronger signal than a guessed name resolving via DNS.
      // Requiring live DNS on top of that would silently drop a domain that's between
      // issuance and DNS propagation, or one that's briefly dormant. The existing
      // dormant-cadence recheck machinery already handles a not-yet-resolving finding
      // correctly from here (see cadence.ts / recheckJob.ts).
      const finding = await tx.finding.create({
        data: {
          brandId,
          identifier: hostname,
          type: "domain",
          source: "ct_log",
          riskScore: 0,
          severity: "low",
          nextScanAt: new Date(),
        },
      });

      // Same "confirmed resolving right now is the only proof we'll ever have at this
      // exact instant" reasoning as discoveryJob.ts -- but skip writing DomainIntel at all
      // if it doesn't resolve yet (not even a currentlyResolves: false row), exactly like
      // a manually-submitted domain finding has no DomainIntel until its first recheck.
      const dns = await checkDnsExistence(hostname);
      if (dns.exists) {
        await tx.domainIntel.create({
          data: { findingId: finding.id, firstResolvedAt: new Date(), currentlyResolves: true },
        });
      }
    });
  }
}
