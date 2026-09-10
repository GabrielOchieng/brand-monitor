-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primary_domain" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_domains" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'primary',

    CONSTRAINT "brand_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_keywords" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'name',

    CONSTRAINT "brand_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_assets" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'domain',
    "source" TEXT NOT NULL DEFAULT 'pipeline',
    "identifier" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "severity" TEXT NOT NULL DEFAULT 'low',
    "status" TEXT NOT NULL DEFAULT 'new',
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_intel" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "registrar" TEXT,
    "registered_at" TIMESTAMP(3),
    "nameservers" TEXT[],
    "ip" TEXT,
    "dns_records" JSONB,
    "whois_source" TEXT,
    "raw_data" JSONB,

    CONSTRAINT "domain_intel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_intel" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "screenshot_path" TEXT,
    "title" TEXT,
    "meta_description" TEXT,
    "extracted_text" TEXT,
    "has_login_form" BOOLEAN NOT NULL DEFAULT false,
    "has_payment_form" BOOLEAN NOT NULL DEFAULT false,
    "looks_parked" BOOLEAN NOT NULL DEFAULT false,
    "favicon_hash" TEXT,
    "redirect_chain" TEXT[],
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_intel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_evidence" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_score_events" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "rule_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_score_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "candidates_total" INTEGER NOT NULL DEFAULT 0,
    "candidates_checked" INTEGER NOT NULL DEFAULT 0,
    "findings_created" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_domains_brand_id_domain_key" ON "brand_domains"("brand_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "brand_keywords_brand_id_keyword_key" ON "brand_keywords"("brand_id", "keyword");

-- CreateIndex
CREATE UNIQUE INDEX "findings_brand_id_identifier_key" ON "findings"("brand_id", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "domain_intel_finding_id_key" ON "domain_intel"("finding_id");

-- CreateIndex
CREATE UNIQUE INDEX "website_intel_finding_id_key" ON "website_intel"("finding_id");

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_domains" ADD CONSTRAINT "brand_domains_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_keywords" ADD CONSTRAINT "brand_keywords_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_intel" ADD CONSTRAINT "domain_intel_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_intel" ADD CONSTRAINT "website_intel_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_evidence" ADD CONSTRAINT "finding_evidence_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_score_events" ADD CONSTRAINT "finding_score_events_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
