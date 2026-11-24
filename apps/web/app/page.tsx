import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Landing } from "../components/landing/Landing";

export const metadata = {
  title: "Brand Monitor: find and take down brand impersonation",
};

// The public landing page. Someone with a session goes straight to the app (the API still
// checks the session; a stale cookie ends up on the sign-in page from there).
export default async function Home() {
  if ((await cookies()).has("bm_session")) redirect("/dashboard");
  return <Landing contactEmail={process.env.NEXT_PUBLIC_CONTACT_EMAIL || null} />;
}
