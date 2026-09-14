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
          <header className="sticky top-0 z-10 border-b border-line bg-base/80 px-6 py-3 backdrop-blur">
            <nav className="mx-auto flex max-w-6xl items-center gap-7">
              <Link href="/dashboard" className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <ShieldIcon className="h-4 w-4" />
                </span>
                <span className="font-semibold tracking-tight text-ink">Brand Monitor</span>
              </Link>
              <SignedIn>
                <Link href="/dashboard" className={navLinkClass}>Dashboard</Link>
                <Link href="/threats" className={navLinkClass}>Threats</Link>
                <div className="ml-auto flex items-center gap-5">
                  <NotificationBell />
                  <div className="h-5 w-px bg-line" />
                  <OrganizationSwitcher
                    hidePersonal
                    appearance={{ variables: { colorPrimary: "#5b4fe0" } }}
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
