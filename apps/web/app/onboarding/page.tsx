import { redirect } from "next/navigation";
import { IndustryOnboarding } from "../../components/ui/industry-onboarding";
import { SignOutButton } from "../../components/ui/sign-out-button";
import { Building2 } from "lucide-react";
import { resolveUserContext } from "../../lib/user-context";
import { resolveHostTheme } from "../../lib/host-theme";

export const dynamic = "force-dynamic";

// Server-side guard: if the signed-in user already has a DB record (owner or
// invitee whose pending invite was auto-accepted on first /auth/identify call),
// skip the industry picker entirely and go straight to /dashboard. This is the
// "invited users skip industry selection" requirement, enforced at the server
// before the picker ever renders.
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  // `?new` lets an existing member add another workspace (multi-workspace) —
  // without it, an existing user is sent straight to their dashboard.
  const sp = await searchParams.catch(() => ({} as { new?: string }));
  const allowAdditional = sp?.new !== undefined;
  try {
    const ctx = await resolveUserContext();
    if (ctx.exists && !allowAdditional) redirect("/dashboard");
  } catch {
    // If resolution fails (API down), fall through and show the picker —
    // a fresh owner will still complete onboarding; an invitee will retry
    // via the client-side useEffect identify call inside IndustryOnboarding.
  }

  // White-label: when onboarding is reached on a tenant's own host, brand as
  // them rather than the hardcoded Eynis wordmark (E-9). Resolved after the
  // redirect guard so it isn't wasted on members who skip the picker.
  const theme = await resolveHostTheme();

  return (
    <div className="onboarding-page">
      <div className="onboarding-topbar">
        <div className="auth-logo">
          <div className="auth-logo-icon" style={{ width: 32, height: 32, background: theme.primaryColor, overflow: "hidden" }}>
            {theme.logoUrl
              ? <img src={theme.logoUrl} alt="" className="w-full h-full object-contain" />
              : <Building2 className="w-5 h-5 text-white" />}
          </div>
          <span className="auth-logo-name" style={{ fontSize: 18 }}>{theme.brandName}</span>
        </div>
        <span className="ml-auto text-xs text-slate-400 mr-3">Step 1 of 1 — Choose your industry</span>
        <SignOutButton />
      </div>
      <IndustryOnboarding allowAdditional={allowAdditional} />
    </div>
  );
}
