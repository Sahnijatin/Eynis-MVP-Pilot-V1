import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { resolveUserContext } from "../lib/user-context";

export const dynamic = "force-dynamic";

// The home page is purely a router: it must ALWAYS redirect, never render UI.
// If we ever return JSX from here, the AppShell layout renders an empty content
// area — which is the blank-screen-on-login bug the user reported.
export default async function HomePage() {
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    user = await currentUser();
  } catch {
    // Clerk threw (misconfigured / network blip) — send to dashboard, which
    // is auth-protected by middleware and will bounce to /sign-in if needed.
    redirect("/dashboard");
  }
  if (!user) redirect("/sign-in");

  // Try to resolve DB context. resolveUserContext has its own timeout so this
  // can never hang the page. If the API is down, ctx.exists will be false —
  // we still send the user to /dashboard (not /onboarding) because an admin
  // who already has a workspace shouldn't be forced back through the wizard
  // just because the API is briefly unreachable.
  let exists = false;
  try {
    const ctx = await resolveUserContext();
    exists = ctx.exists;
  } catch {
    // Treat resolution failure as "go to dashboard" — the dashboard page will
    // gracefully handle missing data, and never lands the user on a blank
    // shell at the root.
    redirect("/dashboard");
  }

  if (exists) redirect("/dashboard");
  redirect("/onboarding");
}
