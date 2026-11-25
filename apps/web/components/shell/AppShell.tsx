"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BrandProvider } from "../../lib/brand";
import { AdminViewBanner } from "../AdminViewBanner";
import { PausedBanner } from "../PausedBanner";
import { TooltipProvider } from "../ui/Menu";
import { BottomBar } from "./BottomBar";
import { CommandPalette } from "./CommandPalette";
import { isBarePath } from "./nav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

// The signed-in console: sidebar (desktop) or bottom bar (phones), top bar, banners, the page.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [search, setSearch] = useState(false);

  if (isBarePath(pathname)) return <>{children}</>;

  return (
    <BrandProvider>
      <TooltipProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-popover"
        >
          Skip to content
        </a>
        {/* Paints the phone's status-bar strip in the top bar's colour. */}
        <div className="fixed inset-x-0 top-0 z-[35] h-[env(safe-area-inset-top)] bg-card" aria-hidden="true" />
        <Sidebar pathname={pathname} />
        <div className="flex min-h-screen min-w-0 flex-col pb-[calc(58px+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[228px]">
          <TopBar onSearch={() => setSearch(true)} />
          <AdminViewBanner />
          <PausedBanner />
          <main
            id="main"
            className="w-full max-w-[1480px] flex-1 py-4 pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] lg:py-[22px] lg:pl-6 lg:pr-[max(24px,env(safe-area-inset-right))]"
          >
            {children}
          </main>
        </div>
        <BottomBar pathname={pathname} />
        <CommandPalette open={search} onOpenChange={setSearch} />
      </TooltipProvider>
    </BrandProvider>
  );
}
