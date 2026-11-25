"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowRight, Search } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { SeverityTag } from "../threat/atoms";
import { Kbd } from "../ui/Button";
import { useNavGroups } from "./Sidebar";

interface Hit {
  id: string;
  identifier: string;
  severity: string;
  status: string;
}

const itemClass = "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-muted-foreground data-[selected=true]:bg-hover data-[selected=true]:text-foreground";
const groupClass = "[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2";

// Ctrl/Cmd+K: jump to any page, or any threat by domain, URL or account name.
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const groups = useNavGroups();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  // Server-side identifier search, debounced; the API caps q at 200 characters.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<{ findings: Hit[] }>(`/api/findings?q=${encodeURIComponent(term.slice(0, 200))}&pageSize=8`);
        if (!cancelled) setHits(r.findings);
      } catch {
        if (!cancelled) setHits([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-[580px] -translate-x-1/2 overflow-hidden rounded-lg border border-border-strong bg-card shadow-popover">
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search threats and pages</DialogPrimitive.Description>
          <Command shouldFilter={false} label="Search">
            <div className="flex items-center gap-2.5 border-b border-border px-3.5 text-subtle">
              <Search className="size-4 shrink-0" aria-hidden="true" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Search threats, domains, pages…" className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-subtle" />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-4 text-[13px] text-subtle">Nothing matches.</Command.Empty>
              {hits.length > 0 && (
                <Command.Group heading="Threats" className={groupClass}>
                  {hits.map((h) => (
                    <Command.Item key={h.id} value={`threat-${h.id}`} onSelect={() => go(`/threats/${h.id}`)} className={itemClass}>
                      <SeverityTag severity={h.severity} />
                      <span className="min-w-0 truncate font-mono text-[12.5px] text-foreground">{h.identifier}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Pages" className={groupClass}>
                {groups
                  .flatMap((g) => g.items)
                  .concat([{ href: "/account", label: "Account and security", Icon: ArrowRight }, { href: "/notifications", label: "Notifications", Icon: ArrowRight }])
                  .filter((i) => !q.trim() || i.label.toLowerCase().includes(q.trim().toLowerCase()))
                  .map((i) => (
                    <Command.Item key={i.href} value={`page-${i.href}`} onSelect={() => go(i.href)} className={itemClass}>
                      <i.Icon className="size-4" aria-hidden="true" />
                      {i.label}
                    </Command.Item>
                  ))}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
