"use client";

import { ReportTemplateSettings } from "../../../components/settings/ReportTemplateSettings";
import { useMyRole } from "../../../lib/useMyRole";
import { useBrands } from "../../../lib/brand";

export default function ReportTemplatesPage() {
  const role = useMyRole();
  const { brands } = useBrands();
  return <ReportTemplateSettings role={role} brands={brands ?? []} />;
}
