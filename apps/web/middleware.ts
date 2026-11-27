import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "./lib/publicPaths";

// Sends anyone without a session cookie to /login, except on public pages (lib/publicPaths.ts).
// Only checks that the cookie exists: the API validates it on every request, and lib/session.tsx
// redirects when it turns out to be dead. "/" is the landing page: it sends a visitor with a
// session cookie on to the dashboard itself.
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (req.cookies.has("bm_session")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
