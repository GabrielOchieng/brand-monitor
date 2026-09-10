import { PrismaClient } from "@prisma/client";
import { severityForScore } from "@brand-monitor/shared";

const prisma = new PrismaClient();

// Concat-term keywords feed the "brand + support/login/refund/..." candidate pattern in
// permutations.ts. Add any additional domains Jambojet legitimately owns to the
// brand_domains allowlist below -- do not guess these, confirm with the brand owner.
const CONCAT_KEYWORDS = ["support", "login", "secure", "verify", "refund", "promo", "booking", "pay", "flights", "ke"];

async function seedDemoFinding(
  brandId: string,
  identifier: string,
  events: Array<{ delta: number; reason: string; ruleCode: string }>,
  extra: { registeredAt?: Date; registrar?: string; hasLoginForm?: boolean; hasPaymentForm?: boolean; title?: string }
) {
  const score = Math.max(0, Math.min(100, events.reduce((s, e) => s + e.delta, 0)));
  const severity = severityForScore(score);

  const finding = await prisma.finding.upsert({
    where: { brandId_identifier: { brandId, identifier } },
    create: { brandId, identifier, type: "domain", source: "seed_demo", riskScore: score, severity },
    update: { riskScore: score, severity, source: "seed_demo" },
  });

  await prisma.domainIntel.upsert({
    where: { findingId: finding.id },
    create: {
      findingId: finding.id,
      registrar: extra.registrar ?? "Example Registrar LLC",
      registeredAt: extra.registeredAt ?? new Date(),
      nameservers: ["ns1.example-hosting.com", "ns2.example-hosting.com"],
      ip: "203.0.113.42",
      dnsRecords: { a: ["203.0.113.42"], aaaa: [], ns: ["ns1.example-hosting.com"], mx: [] },
      whoisSource: "rdap",
    },
    update: {},
  });

  await prisma.websiteIntel.upsert({
    where: { findingId: finding.id },
    create: {
      findingId: finding.id,
      title: extra.title ?? "Account Verification Required",
      metaDescription: "Please verify your account to continue.",
      extractedText: "Verify your account details and payment information to avoid suspension.",
      hasLoginForm: extra.hasLoginForm ?? false,
      hasPaymentForm: extra.hasPaymentForm ?? false,
      looksParked: false,
      redirectChain: [`https://${identifier}/`],
    },
    update: {},
  });

  await prisma.findingScoreEvent.deleteMany({ where: { findingId: finding.id } });
  await prisma.findingScoreEvent.createMany({
    data: events.map((e) => ({ findingId: finding.id, delta: e.delta, reason: e.reason, ruleCode: e.ruleCode })),
  });

  await prisma.findingEvidence.deleteMany({ where: { findingId: finding.id } });
  const positive = events.filter((e) => e.delta > 0);
  if (positive.length > 0) {
    await prisma.findingEvidence.createMany({
      data: positive.map((e) => ({ findingId: finding.id, description: e.reason })),
    });
  }
}

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: "seed-org-jambojet" },
    create: { id: "seed-org-jambojet", name: "Jambojet — POC" },
    update: {},
  });

  const brand = await prisma.brand.upsert({
    where: { id: "seed-brand-jambojet" },
    create: { id: "seed-brand-jambojet", organizationId: org.id, name: "Jambojet", primaryDomain: "jambojet.com" },
    update: {},
  });

  await prisma.brandDomain.upsert({
    where: { brandId_domain: { brandId: brand.id, domain: "jambojet.com" } },
    create: { brandId: brand.id, domain: "jambojet.com", type: "primary" },
    update: {},
  });

  await prisma.brandKeyword.upsert({
    where: { brandId_keyword: { brandId: brand.id, keyword: "jambojet" } },
    create: { brandId: brand.id, keyword: "jambojet", type: "name" },
    update: {},
  });
  await prisma.brandKeyword.upsert({
    where: { brandId_keyword: { brandId: brand.id, keyword: "jambo jet" } },
    create: { brandId: brand.id, keyword: "jambo jet", type: "name" },
    update: {},
  });
  for (const kw of CONCAT_KEYWORDS) {
    await prisma.brandKeyword.upsert({
      where: { brandId_keyword: { brandId: brand.id, keyword: kw } },
      create: { brandId: brand.id, keyword: kw, type: "concat_term" },
      update: {},
    });
  }

  // Guaranteed worked example (source=seed_demo) so the "explainable score" walkthrough
  // doesn't depend on what happens to be registered in the wild on demo day.
  await seedDemoFinding(
    brand.id,
    "jambojet-secure-login.xyz",
    [
      { delta: 30, reason: "Domain strongly resembles protected brand (92% similarity)", ruleCode: "DOMAIN_SIMILARITY_HIGH" },
      { delta: 30, reason: "Domain registered less than 24 hours ago", ruleCode: "DOMAIN_AGE_LT_24H" },
      { delta: 15, reason: "Website favicon matches the protected brand's favicon", ruleCode: "FAVICON_MATCH" },
      { delta: 15, reason: "Login form detected on website", ruleCode: "LOGIN_FORM_DETECTED" },
      { delta: 10, reason: "Registered under a TLD with elevated abuse history", ruleCode: "HIGH_RISK_TLD" },
    ],
    { registeredAt: new Date(Date.now() - 6 * 60 * 60 * 1000), hasLoginForm: true, title: "Jambojet Account Verification" }
  );

  await seedDemoFinding(
    brand.id,
    "jambojet-promo.top",
    [
      { delta: 15, reason: "Domain moderately resembles protected brand (68% similarity)", ruleCode: "DOMAIN_SIMILARITY_MEDIUM" },
      { delta: 10, reason: "Registered under a TLD with elevated abuse history", ruleCode: "HIGH_RISK_TLD" },
      { delta: 15, reason: "Payment-related form or language detected on website", ruleCode: "PAYMENT_FORM_DETECTED" },
    ],
    { registeredAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), hasPaymentForm: true, title: "Claim Your Jambojet Prize" }
  );

  console.log(`Seeded organization "${org.name}" and brand "${brand.name}" with 2 demo findings.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
