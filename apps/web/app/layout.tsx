import "./globals.css";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AppHeader } from "../components/AppHeader";

export const metadata = { title: "Brand Monitor" };

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider appearance={{ variables: { colorPrimary: "#5b4fe0" } }}>
      <html lang="en" className={inter.variable}>
        {/* overflow-x-hidden as a hard safety net -- a third-party widget (Clerk's
            OrganizationSwitcher below) overflowing its own box shouldn't be able to make
            the ENTIRE page horizontally scrollable on mobile; confirmed that's exactly
            what was happening without this. */}
        <body className="min-h-screen overflow-x-hidden bg-base font-sans">
          <AppHeader />
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
