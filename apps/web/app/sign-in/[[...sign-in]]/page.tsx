import { SignIn } from "@clerk/nextjs";
import { Building2 } from "lucide-react";
import { resolveHostTheme } from "../../../lib/host-theme";

export default async function SignInPage() {
  // White-label: when reached on a tenant's own domain/subdomain, brand as them.
  const theme = await resolveHostTheme();

  return (
    <div className="auth-page">
      <div className="auth-brand-panel" style={theme.isTenant ? { background: theme.primaryColor } : undefined}>
        <div className="auth-brand-content">
          <div className="auth-logo">
            <div className="auth-logo-icon" style={theme.isTenant ? { background: "rgba(255,255,255,0.15)", overflow: "hidden" } : undefined}>
              {theme.logoUrl
                ? <img src={theme.logoUrl} alt="" className="w-7 h-7 object-contain" />
                : <Building2 className="w-7 h-7 text-white" />}
            </div>
            <span className="auth-logo-name">{theme.brandName}</span>
          </div>
          {theme.isTenant ? (
            <>
              <h1 className="auth-headline">Welcome back</h1>
              <p className="auth-subline">Sign in to your {theme.brandName} workspace.</p>
            </>
          ) : (
            <>
              <h1 className="auth-headline">Intelligence for every industry</h1>
              <p className="auth-subline">
                From hotel lobbies to factory floors — Eynis gives owners real-time
                visibility, AI-driven automation, and actionable insights.
              </p>
              <div className="auth-industry-pills">
                {["🏨 Hospitality", "🏭 Manufacturing", "🍽️ F&B", "✈️ Travel", "🏥 Healthcare"].map((i) => (
                  <span key={i} className="auth-pill">{i}</span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form-inner">
          {/* fallbackRedirectUrl: goes to / which smart-redirects based on onboarding status.
              Uses fallback (not force) so deep-link redirects still work. */}
          <SignIn fallbackRedirectUrl="/" appearance={{ variables: { colorPrimary: theme.primaryColor } }} />
        </div>
      </div>
    </div>
  );
}
