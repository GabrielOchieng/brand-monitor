import { z } from "zod";

export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingStatusSchema = z.enum([
  "new",
  "investigating",
  "confirmed",
  "false_positive",
  "resolved",
]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const TakedownStatusSchema = z.enum(["requested", "acknowledged", "completed", "rejected"]);
export type TakedownStatus = z.infer<typeof TakedownStatusSchema>;

export const ScoreEventSchema = z.object({
  id: z.string(),
  delta: z.number(),
  reason: z.string(),
  ruleCode: z.string(),
  createdAt: z.string(),
});
export type ScoreEvent = z.infer<typeof ScoreEventSchema>;

export const DomainIntelSchema = z.object({
  registrar: z.string().nullable(),
  registeredAt: z.string().nullable(),
  nameservers: z.array(z.string()),
  ip: z.string().nullable(),
  whoisSource: z.string().nullable(),
}).nullable();

export const WebsiteIntelSchema = z.object({
  screenshotPath: z.string().nullable(),
  title: z.string().nullable(),
  metaDescription: z.string().nullable(),
  extractedText: z.string().nullable(),
  hasLoginForm: z.boolean(),
  hasPaymentForm: z.boolean(),
  faviconHash: z.string().nullable(),
}).nullable();

export const FindingSummarySchema = z.object({
  id: z.string(),
  identifier: z.string(),
  type: z.string(),
  source: z.string(),
  riskScore: z.number(),
  severity: SeveritySchema,
  status: FindingStatusSchema,
  firstDetectedAt: z.string(),
  lastScannedAt: z.string(),
});
export type FindingSummary = z.infer<typeof FindingSummarySchema>;

export const FindingDetailSchema = FindingSummarySchema.extend({
  scoreEvents: z.array(ScoreEventSchema),
  domainIntel: DomainIntelSchema,
  websiteIntel: WebsiteIntelSchema,
  evidence: z.array(
    z.object({ id: z.string(), description: z.string(), createdAt: z.string() })
  ),
});
export type FindingDetail = z.infer<typeof FindingDetailSchema>;

export const PipelineRunSchema = z.object({
  id: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  candidatesTotal: z.number(),
  candidatesChecked: z.number(),
  findingsCreated: z.number(),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type PipelineRun = z.infer<typeof PipelineRunSchema>;

export function severityForScore(score: number): Severity {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

// TODO(next phase): make this per-tenant/configurable once auth+multi-tenancy lands.
export const SCANNER_USER_AGENT =
  "BrandMonitorPOC/0.1 (+responsible-scanning-research; contact=security-poc@localhost)";
