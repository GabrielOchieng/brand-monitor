import "./globals.css";
import { Suspense, type ReactNode } from "react";
import { Inter } from "next/font/google";
import { SessionProvider } from "../lib/session";
import { AppHeader } from "../components/AppHeader";
import { PausedBanner } from "../components/PausedBanner";
import { NavProgress } from "../components/NavProgress";

export const metadata = { title: "Brand Monitor" };

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      {/* overflow-x-hidden as a hard safety net: nothing in the header overflowing its own box
          should be able to make the whole page horizontally scrollable on mobile. */}
      <body className="min-h-screen overflow-x-hidden bg-base font-sans">
        <SessionProvider>
          {/* useSearchParams needs a Suspense boundary. */}
          <Suspense fallback={null}>
            <NavProgress />
          </Suspense>
          <AppHeader />
          <PausedBanner />
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
