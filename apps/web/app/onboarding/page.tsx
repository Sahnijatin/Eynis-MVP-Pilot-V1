import { redirect } from "next/navigation";
import { IndustryOnboarding } from "../../components/ui/industry-onboarding";
import { SignOutButton } from "../../components/ui/sign-out-button";
import { Building2 } from "lucide-react";
import { resolveUserContext } from "../../lib/user-context";

export const dynamic = "force-dynamic";

// Server-side guard: if the signed-in user already has a DB record (owner or
// invitee whose pending invite was auto-accepted on first /auth/identify call),
// skip the industry picker entirely and go straight to /dashboard. This is the
// "invited users skip industry selection" requirement, enforced at the server
// before the picker ever renders.
export default async function OnboardingPage() {
  try {
    const ctx = await resolveUserContext();
    if (ctx.exists) redirect("/dashboard");
  } catch {
    // If resolution fails (API down), fall through and show the picker —
    // a fresh owner will still complete onboarding; an invitee will retry
    // via the client-side useEffect identify call inside IndustryOnboarding.
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-topbar">
        <div className="auth-logo">
          <div className="auth-logo-icon" style={{ width: 32, height: 32 }}>
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <span className="auth-logo-name" style={{ fontSize: 18 }}>Eynis</span>
        </div>
        <span className="ml-auto text-xs text-slate-400 mr-3">Step 1 of 1 — Choose your industry</span>
        <SignOutButton />
      </div>
      <IndustryOnboarding />
    </div>
  );
}
