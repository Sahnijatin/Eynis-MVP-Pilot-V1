import { IndustryOnboarding } from "../../components/ui/industry-onboarding";
import { SignOutButton } from "../../components/ui/sign-out-button";
import { Building2 } from "lucide-react";

// No server-side auth check here — middleware already protects this route.
// Doing currentUser() here can cause a race condition where Clerk hasn't
// finished processing the sign-up session yet, causing a false redirect to /sign-in.

export default function OnboardingPage() {
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
