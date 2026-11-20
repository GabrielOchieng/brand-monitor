import "./globals.css";
import { Suspense, type ReactNode } from "react";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AppHeader } from "../components/AppHeader";
import { NavProgress } from "../components/NavProgress";

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
          {/* useSearchParams needs a Suspense boundary. */}
          <Suspense fallback={null}>
            <NavProgress />
          </Suspense>
          <AppHeader />
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
