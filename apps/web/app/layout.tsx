import "./globals.css";
import { Suspense, type ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { SessionProvider } from "../lib/session";
import { AppShell } from "../components/shell/AppShell";
import { NavProgress } from "../components/NavProgress";
import { THEME_SCRIPT } from "../components/theme/theme";
import { Toaster } from "../components/ui/Toast";

export const metadata = {
  title: { default: "Brand Monitor", template: "%s · Brand Monitor" },
  description: "Find and take down lookalike domains, scam websites and fake accounts impersonating your brand.",
};

const sans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-plex-sans", display: "swap", weight: ["400", "500", "600", "700"] });
// For the data analysts read character by character: domains, URLs, IPs, references.
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-plex-mono", display: "swap", weight: ["400", "500"] });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme may be changed by THEME_SCRIPT before hydration, hence suppressHydrationWarning.
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* overflow-x-hidden as a hard safety net: nothing overflowing its own box should make the
          whole page horizontally scrollable on mobile. */}
      <body className="min-h-screen overflow-x-hidden bg-background font-sans text-[14px] text-foreground">
        <SessionProvider>
          <Toaster>
            {/* useSearchParams needs a Suspense boundary. */}
            <Suspense fallback={null}>
              <NavProgress />
            </Suspense>
            {/* The signed-in app's sidebar and top bar; public pages bring their own layout. */}
            <AppShell>{children}</AppShell>
          </Toaster>
        </SessionProvider>
      </body>
    </html>
  );
}
