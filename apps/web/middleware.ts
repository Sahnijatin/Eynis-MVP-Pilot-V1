import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/request(.*)",
  // Invite acceptance must be reachable while signed out — a brand-new invitee
  // has no account yet. The page itself handles the signed-out → sign-up path.
  "/invite(.*)",
  // Public customer quote link (Phase 6): recipients are external customers with
  // no account. The token in the URL is the only credential; the backing
  // /api/public/quotes/* routes are already public below.
  "/q(.*)",
  "/api/invitations(.*)",
  "/api/public/(.*)",
  // NOTE: /api/connectors/* (connector-config writes) and /api/sse (live tenant
  // feed) are intentionally NOT public — they proxy authenticated backend calls, so
  // Clerk must gate them. Signed-in requests carry the Clerk cookie and pass; only
  // anonymous callers are blocked. (Previously public: F-… tenant-data exposure.)
  // Internal Eynis-staff provisioning console (E-8). It is NOT a Clerk surface —
  // staff authenticate with the platform-admin secret, gated server-side.
  "/admin(.*)",
  "/api/admin(.*)"
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)"
  ]
};
