export type WebStateValue = "live" | "parked" | "offline" | null;

// One row of GET /api/findings.
export interface FindingRow {
  id: string;
  identifier: string;
  type: string;
  source: string;
  riskScore: number;
  severity: string;
  status: string;
  firstDetectedAt: string;
  lastScannedAt: string;
  assigneeId: string | null;
  tags: string[];
  brandName: string;
  webState: WebStateValue;
  topReason: string | null;
}

export interface FindingsResponse {
  findings: FindingRow[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<string, number>;
}

export interface Member {
  userId: string;
  email: string;
  name?: string | null;
  role: string;
}

export interface DomainIntelView {
  registrar: string | null;
  registeredAt: string | null;
  nameservers: string[];
  ip: string | null;
  whoisSource: string | null;
  firstResolvedAt: string | null;
  currentlyResolves: boolean;
  lastChangedAt: string | null;
  expiresAt: string | null;
  statusCodes: string[];
  registrarAbuseEmail: string | null;
  registrarAbusePhone: string | null;
  hostingOrg: string | null;
  hostingAbuseEmail: string | null;
}

export interface WebsiteIntelView {
  screenshotPath: string | null;
  title: string | null;
  metaDescription: string | null;
  hasLoginForm: boolean;
  hasPaymentForm: boolean;
  looksParked: boolean;
  httpStatus: number | null;
  visualSimilarityMatch: boolean;
  scannedAt?: string;
}

export interface SocialIntelView {
  platform: string;
  handle: string | null;
  postUrl: string | null;
  title: string | null;
  snippet: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface IndicatorView {
  kind: string;
  value: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sharedWith: Array<{ id: string; identifier: string; severity: string; status: string }>;
}

// GET /api/findings/:id.
export interface FindingDetail {
  id: string;
  identifier: string;
  riskScore: number;
  severity: string;
  status: string;
  source: string;
  type: string;
  assigneeId: string | null;
  tags: string[];
  firstDetectedAt: string;
  lastScannedAt: string;
  downSince: string | null;
  domainIntel: DomainIntelView | null;
  websiteIntel: WebsiteIntelView | null;
  socialIntel: SocialIntelView | null;
  websiteDataCurrent: boolean;
  underTakedownWatch: boolean;
  changes: Array<{ id: string; field: string; oldValue: string | null; newValue: string | null; detectedAt: string }>;
  indicators: IndicatorView[];
  publicReports: Array<{ id: string; url: string | null; phone: string | null; description: string | null; status: string; createdAt: string }>;
  evidence: Array<{ id: string; description: string }>;
  scoreEvents: Array<{ id: string; delta: number; reason: string; ruleCode: string }>;
  aiExplanation: { status: "pending" | "succeeded" | "failed"; response: string | null; error: string | null; model: string; createdAt: string } | null;
}

// Same rule as the API's lib/findingView.ts webState(), from the detail payload.
export function detailWebState(f: Pick<FindingDetail, "type" | "downSince" | "websiteIntel">): WebStateValue {
  if (f.type === "social") return null;
  if (f.downSince) return "offline";
  const wi = f.websiteIntel;
  if (!wi) return null;
  if (wi.httpStatus != null && ([404, 410, 451].includes(wi.httpStatus) || wi.httpStatus >= 500)) return "offline";
  return wi.looksParked ? "parked" : "live";
}
