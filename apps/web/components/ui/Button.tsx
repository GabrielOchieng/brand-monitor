import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

// primary = the one main action in a view; secondary = other actions; ghost = low emphasis;
// danger = destructive. Sizes: sm for dense rows and panels, md everywhere else, icon for square buttons.
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:brightness-110",
        secondary: "border-border-strong bg-raised text-foreground hover:bg-hover",
        ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
        danger: "border-sev-critical/35 text-sev-critical hover:bg-sev-critical/10",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-[12.5px]",
        md: "h-8 px-3 text-[13px]",
        lg: "h-10 px-4 text-sm",
        icon: "size-8 p-0",
        "icon-sm": "size-7 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, asChild, type, ...props }, ref) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp ref={ref} type={asChild ? undefined : (type ?? "button")} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

// Keyboard hint shown inside a button or a menu, e.g. <Kbd>c</Kbd>.
export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd className={cn("rounded-sm border border-b-2 border-border-strong bg-raised px-1 font-mono text-[10.5px] leading-4 text-muted-foreground", className)}>{children}</kbd>
  );
}
