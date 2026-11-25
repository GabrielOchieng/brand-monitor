"use client";

import Link from "next/link";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/cn";
import { Dialog, SheetContent } from "../ui/Dialog";
import { BOTTOM_NAV, NAV, isActive } from "./nav";
import { NavList } from "./Sidebar";

// Phones: Overview, Threats, Takedowns, and everything else in a sheet behind More.
export function BottomBar({ pathname }: { pathname: string }) {
  const [more, setMore] = useState(false);
  const items = NAV.flatMap((g) => g.items).filter((i) => BOTTOM_NAV.includes(i.href));
  const inMore = !items.some((i) => isActive(pathname, i));
  const cell = "relative flex h-[58px] flex-col items-center justify-center gap-[3px] text-[11px] text-subtle aria-[current=page]:text-primary";
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden"
      >
        {items.map((i) => (
          <Link key={i.href} href={i.href} aria-current={isActive(pathname, i) ? "page" : undefined} className={cell}>
            <i.Icon className="size-5" aria-hidden="true" />
            {i.label}
          </Link>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-current={inMore ? "page" : undefined} className={cn(cell)} aria-haspopup="dialog">
          <MoreHorizontal className="size-5" aria-hidden="true" />
          More
        </button>
      </nav>
      <Dialog open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" title="All pages" hideTitle>
          <NavList pathname={pathname} onNavigate={() => setMore(false)} />
        </SheetContent>
      </Dialog>
    </>
  );
}
