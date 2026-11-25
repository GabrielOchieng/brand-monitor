"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full bg-border-strong transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 translate-x-[3px] rounded-full bg-foreground transition-transform data-[state=checked]:translate-x-[17px] data-[state=checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );
}

type ToggleRowProps = { label: ReactNode; hint?: ReactNode; children: ReactNode };

// One labelled switch in a list of them.
export function ToggleRow({ label, hint, children }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-[13px] last:border-b-0">
      <div className="min-w-0">
        {label}
        {hint && <div className="text-xs text-subtle">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
