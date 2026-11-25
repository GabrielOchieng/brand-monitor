import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "info" | "warn" | "ok" | "error";

const TONES: Record<Tone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: "border-border-strong bg-raised", icon: "text-muted-foreground", Icon: Info },
  warn: { box: "border-sev-medium/40 bg-sev-medium/8", icon: "text-sev-medium", Icon: AlertTriangle },
  ok: { box: "border-ok/40 bg-ok/8", icon: "text-ok", Icon: CheckCircle2 },
  error: { box: "border-sev-critical/40 bg-sev-critical/8", icon: "text-sev-critical", Icon: XCircle },
};

type BannerProps = { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode };

// A one-line state message across a page or panel: what is true, and the way to change it.
export function Banner({ tone = "info", title, children, action, className, icon }: BannerProps) {
  const t = TONES[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-md border px-3.5 py-2.5 text-[13px] text-muted-foreground", t.box, className)} role={tone === "error" ? "alert" : undefined}>
      <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", t.icon)}>{icon ?? <t.Icon />}</span>
      <div className="min-w-0 flex-1">
        {title && <span className="font-semibold text-foreground">{title} </span>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
