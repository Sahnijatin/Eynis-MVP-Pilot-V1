import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/request(.*)",
  // Invite acceptance must be reachable while signed out — a brand-new invitee
  // has no account yet. The page itself handles the signed-out → sign-up path.
  "/invite(.*)",
  "/api/invitations(.*)",
  "/api/public/(.*)",
  "/api/connectors/(.*)",
  "/api/sse(.*)",
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
