import { AppWindow, AtSign, Globe, Link2 } from "lucide-react";

// What kind of thing a finding or official account is: a site, an app, an account or a link.
export function TargetIcon({ type, platform }: { type: string; platform: string | null }) {
  const Icon = type === "domain" ? Globe : platform === "Google Play" || platform === "App Store" ? AppWindow : type === "social" ? AtSign : Link2;
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-raised text-subtle">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
