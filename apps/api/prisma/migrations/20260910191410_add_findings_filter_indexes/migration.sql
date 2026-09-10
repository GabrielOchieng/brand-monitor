-- CreateIndex
CREATE INDEX "findings_brand_id_status_idx" ON "findings"("brand_id", "status");

-- CreateIndex
CREATE INDEX "findings_brand_id_severity_idx" ON "findings"("brand_id", "severity");

-- CreateIndex
CREATE INDEX "findings_brand_id_assignee_id_idx" ON "findings"("brand_id", "assignee_id");

-- CreateIndex
CREATE INDEX "findings_brand_id_risk_score_idx" ON "findings"("brand_id", "risk_score");
