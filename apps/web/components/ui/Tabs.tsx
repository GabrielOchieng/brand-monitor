"use client";

import Link from "next/link";
import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

// Underlined tabs. The list scrolls sideways on narrow screens instead of wrapping.
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

const listClass = "flex gap-0.5 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const tabClass =
  "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-foreground";

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn(listClass, className)} {...props} />;
}

export function TabsTrigger({ className, count, children, ...props }: ComponentProps<typeof TabsPrimitive.Trigger> & { count?: number | string }) {
  return (
    <TabsPrimitive.Trigger className={cn(tabClass, "group", className)} {...props}>
      {children}
      {count !== undefined && <TabCount>{count}</TabCount>}
    </TabsPrimitive.Trigger>
  );
}

function TabCount({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm bg-raised px-1.5 font-mono text-[11px] font-normal text-subtle group-data-[state=active]:bg-primary-soft group-data-[state=active]:text-primary group-aria-[current=page]:bg-primary-soft group-aria-[current=page]:text-primary">
      {children}
    </span>
  );
}

// Tabs that are links, for views addressable by URL (saved views, settings sections).
type LinkTabsProps = { items: Array<{ href: string; label: ReactNode; count?: number | string; active: boolean }>; className?: string; label: string };

export function LinkTabs({ items, className, label }: LinkTabsProps) {
  return (
    <nav aria-label={label} className={cn(listClass, className)}>
      {items.map((t) => (
        <Link key={t.href} href={t.href} scroll={false} aria-current={t.active ? "page" : undefined} className={cn(tabClass, "group")}>
          {t.label}
          {t.count !== undefined && <TabCount>{t.count}</TabCount>}
        </Link>
      ))}
    </nav>
  );
}
