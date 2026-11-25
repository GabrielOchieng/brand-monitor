import { serverApiFetch } from "../../../lib/serverApi";
import { ThreatView } from "../../../components/threat/ThreatView";
import type { FindingDetail } from "../../../components/threat/types";

export default async function ThreatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const finding = await serverApiFetch<FindingDetail>(`/api/findings/${id}`);
  return <ThreatView finding={finding} />;
}
