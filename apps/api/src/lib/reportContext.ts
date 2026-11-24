import type { Prisma } from "@prisma/client";
import { KE_CIRT_EMAIL } from "./takedownKit";
import { authorizationInForce } from "./takedownAutomation";
import { defaultTemplate, type Channel, type Kind, type ReportContext, type TemplateText } from "./reportTemplates";

// Loads what a report about one finding says (lib/reportTemplates.ts renders it), which template
// applies, and who it goes to by default. Runs inside withTenant.

export function screenshotFileOf(screenshotPath: string | null | undefined): string | null {
  const m = screenshotPath?.match(/^\/screenshots\/([A-Za-z0-9_-]+\.png)$/);
  return m ? m[1] : null;
}

export interface LoadedFinding {
  id: string;
  brandId: string;
  type: string;
  identifier: string;
  screenshotFile: string | null;
  domainIntel: { registrarAbuseEmail: string | null; hostingAbuseEmail: string | null; hostingOrg: string | null } | null;
}

export async function loadReportContext(
  tx: Prisma.TransactionClient,
  orgId: string,
  findingId: string,
  opts: { reportRef: string; apiOrigin: string; now?: Date }
): Promise<{ context: ReportContext; finding: LoadedFinding } | null> {
  const finding = await tx.finding.findUnique({
    where: { id: findingId },
    include: {
      brand: { select: { id: true, name: true, primaryDomain: true, organizationId: true } },
      domainIntel: true,
      websiteIntel: { select: { title: true, screenshotPath: true, scannedAt: true, looksParked: true, httpStatus: true } },
    },
  });
  if (!finding || finding.brand.organizationId !== orgId) return null;

  const now = opts.now ?? new Date();
  const [scoreEvents, indicators, org, automation, sender, authorizations] = await Promise.all([
    finding.lastScanId
      ? tx.findingScoreEvent.findMany({ where: { scanId: finding.lastScanId, delta: { gt: 0 } }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    tx.findingIndicator.findMany({ where: { findingId }, orderBy: [{ kind: "asc" }, { lastSeenAt: "desc" }] }),
    tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
    tx.takedownAutomation.findUnique({ where: { organizationId: orgId }, select: { companyDetails: true, disclaimer: true } }),
    tx.takedownSender.findUnique({ where: { organizationId: orgId }, select: { signature: true } }),
    tx.takedownAuthorization.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } }),
  ]);
  const signatory = authorizations.find((a) => authorizationInForce(a, finding.brandId, now)) ?? null;

  const url = /^https?:\/\//i.test(finding.identifier) ? finding.identifier : `https://${finding.identifier}`;
  let domain = finding.identifier;
  try {
    domain = new URL(url).hostname;
  } catch {
    // keep the identifier
  }
  const di = finding.domainIntel;
  const wi = finding.websiteIntel;
  const screenshotFile = screenshotFileOf(wi?.screenshotPath);

  const context: ReportContext = {
    finding: { url, domain, firstDetectedAt: finding.firstDetectedAt },
    brand: { name: finding.brand.name, officialDomain: finding.brand.primaryDomain },
    registrar: { name: di?.registrar ?? null, ianaId: di?.registrarIanaId ?? null },
    registeredAt: di?.registeredAt ?? null,
    nameservers: di?.nameservers ?? [],
    ip: di?.ip ?? null,
    hostingOrg: di?.hostingOrg ?? null,
    lastChecked: wi
      ? { at: wi.scannedAt, live: !finding.downSince && !wi.looksParked && wi.httpStatus !== null && wi.httpStatus < 400 }
      : null,
    reasons: scoreEvents.map((e) => e.reason),
    indicators: indicators.map((i) => ({ kind: i.kind, value: i.value })),
    screenshotUrl: screenshotFile ? `${opts.apiOrigin}/screenshots/${screenshotFile}` : null,
    org: { name: org.name, details: automation?.companyDetails ?? null, disclaimer: automation?.disclaimer ?? null },
    signature: sender?.signature ?? null,
    signatory: signatory ? { name: signatory.signatoryName, title: signatory.signatoryTitle, email: signatory.signatoryEmail } : null,
    reportRef: opts.reportRef,
    previous: null,
  };
  return {
    context,
    finding: {
      id: finding.id,
      brandId: finding.brandId,
      type: finding.type,
      identifier: finding.identifier,
      screenshotFile,
      domainIntel: di ? { registrarAbuseEmail: di.registrarAbuseEmail, hostingAbuseEmail: di.hostingAbuseEmail, hostingOrg: di.hostingOrg } : null,
    },
  };
}

export interface ResolvedTemplate extends TemplateText {
  // "default" or the TakedownTemplateVersion id.
  source: string;
  version: number | null;
  scope: "default" | "org" | "brand";
}

// The published text for this channel/kind: the brand's own, else the org's, else built-in.
// A language without its own template falls back to English, then to the built-in text.
export async function resolveTemplate(
  tx: Prisma.TransactionClient,
  orgId: string,
  brandId: string | null,
  channel: Channel,
  kind: Kind,
  language = "en"
): Promise<ResolvedTemplate> {
  const scopes = [...(brandId ? [brandId] : []), "org"];
  const languages = [...new Set([language, "en"])];
  const published = await tx.takedownTemplateVersion.findMany({
    where: { organizationId: orgId, status: "published", template: { organizationId: orgId, channel, kind, scopeKey: { in: scopes }, language: { in: languages } } },
    include: { template: { select: { scopeKey: true, language: true } } },
  });
  for (const lang of languages) {
    for (const scope of scopes) {
      const v = published.find((p) => p.template.scopeKey === scope && p.template.language === lang);
      if (v) return { subject: v.subject, body: v.body, source: v.id, version: v.version, scope: scope === "org" ? "org" : "brand" };
    }
  }
  return { ...defaultTemplate(channel, kind), source: "default", version: null, scope: "default" };
}

// Who a new draft is addressed to, until the contact book (step 3) exists.
export function defaultRecipients(channel: Channel, f: LoadedFinding): string[] {
  switch (channel) {
    case "registrar":
      return f.domainIntel?.registrarAbuseEmail ? [f.domainIntel.registrarAbuseEmail.toLowerCase()] : [];
    case "host":
      return f.domainIntel?.hostingAbuseEmail ? [f.domainIntel.hostingAbuseEmail.toLowerCase()] : [];
    case "cert":
      return [KE_CIRT_EMAIL];
    case "blocklist":
      return [];
  }
}

// Which channels a finding can get a report on. Registrar only for a domain finding: a URL
// finding usually sits on someone else's domain (free hosting, a hacked site).
export function channelsFor(findingType: string): Channel[] {
  if (findingType === "social") return [];
  return findingType === "domain" ? ["registrar", "host", "cert", "blocklist"] : ["host", "cert", "blocklist"];
}
