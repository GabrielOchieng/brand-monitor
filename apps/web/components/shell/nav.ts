import { Flag, LayoutDashboard, ListChecks, MessagesSquare, Settings, ShieldAlert, ShieldCheck, Tags, Users, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; Icon: LucideIcon; match?: string[] };
export type NavGroup = { label: string; items: NavItem[] };

// The app's information architecture (UI_REDESIGN_PLAN.md §2): watch, respond, configure.
export const NAV: NavGroup[] = [
  {
    label: "Monitor",
    items: [
      { href: "/dashboard", label: "Overview", Icon: LayoutDashboard },
      { href: "/threats", label: "Threats", Icon: ListChecks },
      { href: "/mentions", label: "Mentions", Icon: MessagesSquare },
    ],
  },
  {
    label: "Respond",
    items: [
      { href: "/takedowns", label: "Takedowns", Icon: ShieldAlert },
      { href: "/reports", label: "Public reports", Icon: Flag },
    ],
  },
  {
    label: "Configure",
    items: [
      { href: "/brands", label: "Brands", Icon: Tags },
      { href: "/settings", label: "Settings", Icon: Settings },
      { href: "/team", label: "Team", Icon: Users },
    ],
  },
];

export const ADMIN_GROUP: NavGroup = { label: "Platform", items: [{ href: "/admin", label: "Admin panel", Icon: ShieldCheck }] };

// Phone bottom bar: the three places people act from a phone; everything else is under More.
export const BOTTOM_NAV = ["/dashboard", "/threats", "/takedowns"];

export function isActive(pathname: string, item: NavItem): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.match ?? []).some((m) => pathname.startsWith(m));
}

// Pages that aren't part of the signed-in app: the landing page, sign-in flows and the public
// scam-report form. They bring their own layout.
const AUTH_PATHS = ["/login", "/forgot-password", "/reset-password", "/invite", "/confirm-email"];

export function isBarePath(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/" || pathname.startsWith("/report/") || AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
