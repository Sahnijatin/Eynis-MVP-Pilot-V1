import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function HomePage() {
  // Only wrap the Clerk call — never wrap redirect() in try/catch
  // because Next.js redirect() works by throwing a special error internally
  let user = null;
  try {
    user = await currentUser();
  } catch {
    // Clerk not configured (dev mode without keys) — go straight to dashboard
    redirect("/dashboard");
  }

  if (!user) redirect("/sign-in");
  if (!user.unsafeMetadata?.onboardingCompleted) redirect("/onboarding");
  redirect("/dashboard");
}
