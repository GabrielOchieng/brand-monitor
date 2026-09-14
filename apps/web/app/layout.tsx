import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { Inter } from "next/font/google";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  OrganizationSwitcher,
} from "@clerk/nextjs";
import { NotificationBell } from "../components/NotificationBell";
import { ShieldIcon } from "../components/icons";

export const metadata = { title: "Brand Monitor" };

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

const navLinkClass = "text-sm font-medium text-ink-subtle transition-colors hover:text-ink";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider appearance={{ variables: { colorPrimary: "#5b4fe0" } }}>
      <html lang="en" className={inter.variable}>
        <body className="min-h-screen bg-base font-sans">
          <header className="sticky top-0 z-10 border-b border-line bg-base/80 py-3 backdrop-blur">
            {/* Same mx-auto max-w-6xl px-6 shape as <main> below -- padding used to live on
                <header> itself, outside this box, so the nav centered within a narrower
                area than main did and the two never quite lined up at the edges. */}
            <nav className="mx-auto flex max-w-6xl items-center gap-7 px-6">
              <Link href="/dashboard" className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <ShieldIcon className="h-4 w-4" />
                </span>
                <span className="font-semibold tracking-tight text-ink">Brand Monitor</span>
              </Link>
              <SignedIn>
                <Link href="/dashboard" className={navLinkClass}>Dashboard</Link>
                <Link href="/threats" className={navLinkClass}>Threats</Link>
                <div className="ml-auto flex min-w-0 items-center gap-5">
                  <NotificationBell />
                  <div className="h-5 w-px shrink-0 bg-line" />
                  {/* A long org name doesn't shrink or truncate on its own inside Clerk's
                      trigger button -- without a cap here it can render wider than this
                      max-w-6xl header and overflow past the right edge, while <main>
                      (plain text/Tailwind, shrinks normally) stays correctly bounded. */}
                  <OrganizationSwitcher
                    hidePersonal
                    appearance={{
                      variables: { colorPrimary: "#5b4fe0" },
                      elements: {
                        organizationSwitcherTrigger: "max-w-[180px]",
                        organizationPreviewTextContainer: "truncate",
                      },
                    }}
                    afterCreateOrganizationUrl="/dashboard"
                    afterSelectOrganizationUrl="/dashboard"
                  />
                  <UserButton />
                </div>
              </SignedIn>
              <SignedOut>
                <div className="ml-auto">
                  <SignInButton mode="modal" />
                </div>
              </SignedOut>
            </nav>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
