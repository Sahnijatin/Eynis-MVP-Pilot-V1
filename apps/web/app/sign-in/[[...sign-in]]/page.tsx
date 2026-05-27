import { SignIn } from "@clerk/nextjs";
import { Building2 } from "lucide-react";

export default function SignInPage() {
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
        </div>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form-inner">
          {/* fallbackRedirectUrl: goes to / which smart-redirects based on onboarding status.
              Uses fallback (not force) so deep-link redirects still work. */}
          <SignIn fallbackRedirectUrl="/" />
        </div>
      </div>
    </div>
  );
}
