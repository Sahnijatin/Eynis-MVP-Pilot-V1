import { SignUp } from "@clerk/nextjs";
import { Building2 } from "lucide-react";

export default function SignUpPage() {
  return (
    <div className="auth-page">
      <div className="auth-brand-panel">
        <div className="auth-brand-content">
          <div className="auth-logo">
            <div className="auth-logo-icon">
              <Building2 className="w-7 h-7 text-white" />
            </div>
            <span className="auth-logo-name">Eynis</span>
          </div>
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
        </div>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form-inner">
          {/* forceRedirectUrl ensures users ALWAYS land on onboarding after sign-up,
              regardless of any redirect_url query param Clerk might carry */}
          <SignUp forceRedirectUrl="/onboarding" />
        </div>
      </div>
    </div>
  );
}
