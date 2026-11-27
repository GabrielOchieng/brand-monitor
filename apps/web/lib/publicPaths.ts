// Pages that work signed out: the one list both middleware.ts (no session cookie at all) and
// lib/session.tsx (a cookie that's no longer valid) check. Two copies drifted once: /request-access
// was public in the middleware only, so the page loaded and then bounced to /login.
export const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/invite", "/confirm-email", "/request-access", "/report/"];

export function isPublicPath(pathname: string | null): boolean {
  // "/" is the public landing page (exact match only: as a prefix it would cover everything).
  if (pathname === "/") return true;
  return !!pathname && PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}
