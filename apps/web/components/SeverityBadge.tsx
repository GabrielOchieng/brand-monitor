import { SeverityTag } from "./threat/atoms";

// Kept for pages not yet rebuilt; it renders the console's severity tag.
export function SeverityBadge({ severity }: { severity: string }) {
  return <SeverityTag severity={severity} />;
}
