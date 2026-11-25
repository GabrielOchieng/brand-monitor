// Where a notification leads: its threat, an external page (a fact-check's article), the public
// reports list for a report that matched no threat, or else the threat list.
export function notificationHref(n: { findingId: string | null; link: string | null; reportId?: string | null }): { href: string; external: boolean } {
  if (n.findingId) return { href: `/threats/${n.findingId}`, external: false };
  if (n.link) return { href: n.link, external: true };
  if (n.reportId) return { href: "/reports", external: false };
  return { href: "/threats", external: false };
}
