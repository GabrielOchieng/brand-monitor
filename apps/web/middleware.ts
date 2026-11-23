import { NextResponse, type NextRequest } from "next/server";

// Sends anyone without a session cookie to /login. Only checks that the cookie exists: the API
// validates it on every request, and lib/session.tsx redirects when it turns out to be dead.
// /report/<token> is the public scam-report form a brand shares with its customers.
const PUBLIC = [/^\/login$/, /^\/forgot-password$/, /^\/reset-password$/, /^\/invite$/, /^\/confirm-email$/, /^\/report\//];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (req.cookies.has("bm_session")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
