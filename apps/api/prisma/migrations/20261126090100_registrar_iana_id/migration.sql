-- The registrar's IANA ID from RDAP/WHOIS, named in takedown reports (lib/reportTemplates.ts).
ALTER TABLE "domain_intel" ADD COLUMN "registrar_iana_id" TEXT;
