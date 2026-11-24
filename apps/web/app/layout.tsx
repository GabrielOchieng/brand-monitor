import "./globals.css";
import { Suspense, type ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SessionProvider } from "../lib/session";
import { AppFrame } from "../components/AppFrame";
import { NavProgress } from "../components/NavProgress";

export const metadata = {
  title: { default: "Brand Monitor", template: "%s · Brand Monitor" },
  description: "Find and take down lookalike domains, scam websites and fake accounts impersonating your brand.",
};

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
// For the data analysts read character by character: domains, URLs, IPs, references.
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500"] });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      {/* overflow-x-hidden as a hard safety net: nothing overflowing its own box should make the
          whole page horizontally scrollable on mobile. */}
      <body className="min-h-screen overflow-x-hidden bg-base font-sans">
        <SessionProvider>
          {/* useSearchParams needs a Suspense boundary. */}
          <Suspense fallback={null}>
            <NavProgress />
          </Suspense>
          {/* The signed-in app's sidebar and top bar; public pages bring their own layout. */}
          <AppFrame>{children}</AppFrame>
        </SessionProvider>
      </body>
    </html>
  );
}
