import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  OrganizationSwitcher,
} from "@clerk/nextjs";
import { dark } from "@clerk/themes";

export const metadata = { title: "Brand Monitor" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider appearance={{ baseTheme: dark }}>
      <html lang="en">
        <body className="min-h-screen">
          <header className="border-b border-gray-800 px-6 py-4">
            <nav className="flex items-center gap-6">
              <span className="font-semibold text-gray-100">Brand Monitor</span>
              <SignedIn>
                <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-100">Dashboard</Link>
                <Link href="/threats" className="text-sm text-gray-400 hover:text-gray-100">Threats</Link>
                <div className="ml-auto flex items-center gap-4">
                  <OrganizationSwitcher
                    hidePersonal
                    appearance={{ baseTheme: dark }}
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
          <main className="px-6 py-8">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
