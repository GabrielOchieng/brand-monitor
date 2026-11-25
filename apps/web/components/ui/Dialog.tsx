"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

// Modal dialogs and side sheets share Radix Dialog: focus trap, Escape, scroll lock, focus return.
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay() {
  return <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />;
}

type ContentProps = ComponentProps<typeof DialogPrimitive.Content> & { title: ReactNode; description?: ReactNode; hideTitle?: boolean };

function Heading({ title, description, hideTitle }: Pick<ContentProps, "title" | "description" | "hideTitle">) {
  return (
    <div className={cn("flex flex-col gap-1 pr-8", hideTitle && "sr-only")}>
      <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="text-[13px] text-muted-foreground">{description}</DialogPrimitive.Description>
      ) : (
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
      )}
    </div>
  );
}

function CloseButton() {
  return (
    <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground" aria-label="Close">
      <X className="size-4" />
    </DialogPrimitive.Close>
  );
}

export function DialogContent({ className, children, title, description, hideTitle, ...props }: ContentProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-[12vh] z-50 flex max-h-[80vh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-border-strong bg-card p-5 shadow-popover data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      >
        <Heading title={title} description={description} hideTitle={hideTitle} />
        {children}
        <CloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// A panel sliding in from the right (desktop detail panels) or up from the bottom (mobile menus).
export function SheetContent({ className, children, title, description, hideTitle, side = "right", ...props }: ContentProps & { side?: "right" | "bottom" }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col gap-4 overflow-y-auto border-border-strong bg-card p-4 shadow-popover data-[state=open]:animate-in data-[state=closed]:animate-out",
          side === "right" && "inset-y-0 right-0 w-full max-w-md border-l pr-[max(16px,env(safe-area-inset-right))] data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
          side === "bottom" &&
            "inset-x-0 bottom-0 max-h-[85vh] rounded-t-xl border-t pb-[calc(16px+env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
          className
        )}
        {...props}
      >
        {side === "bottom" && <div className="mx-auto -mt-1 h-1 w-9 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />}
        <Heading title={title} description={description} hideTitle={hideTitle} />
        {children}
        {side === "right" && <CloseButton />}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap justify-end gap-2 pt-1", className)} {...props} />;
}
