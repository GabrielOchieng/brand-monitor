import { API_URL } from "../../../lib/api";
import { ReportForm } from "../../../components/ReportForm";

export const metadata = { title: "Report a scam" };

// Public, no login: a brand shares this link with its customers ("seen a fake Jambojet
// page or number? report it here"). The token picks the brand; an unknown or rotated
// token just says the link isn't active.
export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // A down/waking API must not look like a dead link to a customer mid-report.
  let brand: { brandName: string } | null = null;
  let unavailable = false;
  try {
    const res = await fetch(`${API_URL}/api/public/reports/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (res.ok) brand = await res.json();
    else if (res.status !== 404) unavailable = true;
  } catch {
    unavailable = true;
  }

  return (
    <div className="mx-auto max-w-lg">
      {unavailable ? (
        <div className="card p-6 text-center">
          <h1 className="text-lg font-semibold text-ink">Reporting is temporarily unavailable</h1>
          <p className="mt-2 text-sm text-ink-muted">Please try again in a few minutes.</p>
        </div>
      ) : brand ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Report a {brand.brandName} scam</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Seen a fake website, social media page, or a phone/WhatsApp number pretending to be {brand.brandName}? Tell us
            here. Our team reviews every report. We can&apos;t reply to each one, and we will never ask you for a password,
            PIN or payment.
          </p>
          <ReportForm token={token} siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} />
        </>
      ) : (
        <div className="card p-6 text-center">
          <h1 className="text-lg font-semibold text-ink">This report link isn&apos;t active</h1>
          <p className="mt-2 text-sm text-ink-muted">Please use the link on the company&apos;s official website.</p>
        </div>
      )}
    </div>
  );
}
