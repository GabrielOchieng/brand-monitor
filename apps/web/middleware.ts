import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /report/<token> is the public scam-report form a brand shares with its customers.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/report/(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
