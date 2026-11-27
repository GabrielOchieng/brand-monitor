import Link from "next/link";
import { AuthCard } from "../../components/AuthCard";
import { AccessRequestForm } from "../../components/AccessRequestForm";

export const metadata = { title: "Request access" };

export default function RequestAccessPage() {
  return (
    <AuthCard
      title="Request access"
      subtitle={
        <>
          Tell us about your organization and we&apos;ll set up an account. Already have one?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
          .
        </>
      }
    >
      <AccessRequestForm siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} />
    </AuthCard>
  );
}
