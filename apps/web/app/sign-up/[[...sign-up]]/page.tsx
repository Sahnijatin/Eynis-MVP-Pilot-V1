import { SignUp } from "@clerk/nextjs";
import { Building2 } from "lucide-react";
import { resolveHostTheme } from "../../../lib/host-theme";

export default async function SignUpPage() {
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
              <h1 className="auth-headline">Create your account</h1>
              <p className="auth-subline">Join your {theme.brandName} workspace.</p>
            </>
          ) : (
            <>
              <h1 className="auth-headline">Start your free workspace</h1>
              <p className="auth-subline">
                Set up in under 2 minutes. Pick your industry, connect your first
                tool, and your AI command centre is live.
              </p>
              <div className="auth-features">
                {[
                  { icon: "⚡", text: "Live AI intelligence from day one" },
                  { icon: "🔌", text: "Connect WhatsApp, PMS, ERP in one click" },
                  { icon: "🔒", text: "Multi-tenant — your data stays yours" }
                ].map((f) => (
                  <div key={f.text} className="auth-feature-row">
                    <span>{f.icon}</span>
                    <span>{f.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form-inner">
          {/* Route through "/" so invited users (who already have a DB record
              via /auth/identify auto-accept) land on /dashboard, while brand-new
              owners fall through to /onboarding. Skipping the industry picker
              for invitees is handled there. */}
          <SignUp forceRedirectUrl="/" appearance={{ variables: { colorPrimary: theme.primaryColor } }} />
        </div>
      </div>
    </div>
  );
}
