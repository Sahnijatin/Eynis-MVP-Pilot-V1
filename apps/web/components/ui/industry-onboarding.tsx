"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { INDUSTRY_CONFIGS, type Industry } from "../../lib/industry-config";
import { CheckCircle, ArrowRight, Loader2, Check } from "lucide-react";

const INDUSTRIES = Object.values(INDUSTRY_CONFIGS);

export function IndustryOnboarding() {
  const { user, isLoaded } = useUser();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedIndustry, setSelectedIndustry] = useState<Industry | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const config = selectedIndustry ? INDUSTRY_CONFIGS[selectedIndustry] : null;

  if (isLoaded && user?.unsafeMetadata?.onboardingCompleted) {
    window.location.replace("/dashboard");
    return null;
  }

  if (!isLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Loader2 className="w-7 h-7 animate-spin" />
          <span className="text-sm">Setting up your workspace...</span>
        </div>
      </div>
    );
  }

  async function handleFinish() {
    if (!selectedIndustry || !user) return;
    setSaving(true);
    try {
      await user.update({
        unsafeMetadata: { industry: selectedIndustry, onboardingAnswers: answers, onboardingCompleted: true }
      });
      window.location.href = "/dashboard";
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="onboarding-shell">

      {/* Step indicators */}
      <div className="onboarding-progress">
        {([1, 2, 3] as const).map((s) => (
          <div
            key={s}
            className={`onboarding-step-dot ${step >= s ? "active" : ""}`}
            style={step >= s && config ? { borderColor: config.accentColor, color: config.accentColor, background: config.accentColor + "12" } : {}}
          >
            {step > s ? <Check className="w-3.5 h-3.5" /> : s}
          </div>
        ))}
      </div>

      {/* ── Step 1: Industry cards ── */}
      {step === 1 && (
        <div className="onboarding-content">
          <h1 className="onboarding-title">Choose your industry workspace</h1>
          <p className="onboarding-subtitle">
            Eynis configures its modules, terminology, and AI models specifically for your industry.
          </p>

          <div className="industry-select-grid">
            {INDUSTRIES.map((ind) => {
              const Icon = ind.overviewIcon;
              const isSelected = selectedIndustry === ind.id;
              return (
                <button
                  key={ind.id}
                  onClick={() => setSelectedIndustry(ind.id)}
                  className="industry-select-card"
                  style={isSelected ? {
                    borderColor: ind.accentColor,
                    boxShadow: `0 0 0 3px ${ind.accentColor}18`,
                    background: "#fff"
                  } : {}}
                >
                  {/* Left: icon + accent bar */}
                  <div className="industry-select-icon" style={{ background: ind.accentColor + "12" }}>
                    <Icon className="w-5 h-5" style={{ color: ind.accentColor }} />
                  </div>

                  {/* Middle: name + features */}
                  <div className="industry-select-body">
                    <div className="industry-select-name" style={isSelected ? { color: ind.accentColor } : {}}>
                      {ind.name}
                    </div>
                    <div className="industry-select-desc">{ind.description}</div>
                    <div className="industry-select-features">
                      {ind.features.slice(0, 3).map((f) => (
                        <span key={f} className="industry-feature-tag" style={isSelected ? { background: ind.accentColor + "12", color: ind.accentColor, borderColor: ind.accentColor + "30" } : {}}>
                          {f}
                        </span>
                      ))}
                      {ind.features.length > 3 && (
                        <span className="industry-feature-tag" style={{ color: "#94a3b8", borderColor: "#e2e8f0" }}>
                          +{ind.features.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: check */}
                  <div className={`industry-select-check ${isSelected ? "visible" : ""}`} style={{ color: ind.accentColor }}>
                    <CheckCircle className="w-5 h-5" />
                  </div>
                </button>
              );
            })}
          </div>

          <div className="onboarding-actions">
            <button
              className="onboarding-btn-primary"
              disabled={!selectedIndustry}
              onClick={() => setStep(2)}
              style={selectedIndustry ? { background: INDUSTRY_CONFIGS[selectedIndustry].accentColor } : {}}
            >
              Continue <ArrowRight className="w-4 h-4 inline ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Sub-questions ── */}
      {step === 2 && config && (
        <div className="onboarding-content">
          <div className="onboarding-industry-badge" style={{ background: config.accentColor + "12", color: config.accentColor }}>
            {(() => { const Icon = config.overviewIcon; return <Icon className="w-4 h-4" />; })()}
            {config.name}
          </div>
          <h1 className="onboarding-title">Tell us a bit more</h1>
          <p className="onboarding-subtitle">Two quick questions to tailor your workspace.</p>

          <div className="onboarding-questions">
            {config.onboardingQuestions.map((q) => (
              <div key={q.id} className="onboarding-question">
                <div className="onboarding-question-label">{q.question}</div>
                <div className="onboarding-options">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                      className={`onboarding-option ${answers[q.id] === opt ? "selected" : ""}`}
                      style={answers[q.id] === opt
                        ? { borderColor: config.accentColor, background: config.accentColor + "10", color: config.accentColor }
                        : {}}
                    >
                      {answers[q.id] === opt && <Check className="w-3.5 h-3.5 inline mr-1.5" />}
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="onboarding-actions">
            <button className="onboarding-btn-secondary" onClick={() => setStep(1)}>Back</button>
            <button
              className="onboarding-btn-primary"
              disabled={config.onboardingQuestions.some((q) => !answers[q.id])}
              onClick={() => setStep(3)}
              style={{ background: config.accentColor }}
            >
              Continue <ArrowRight className="w-4 h-4 inline ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Confirm + launch ── */}
      {step === 3 && config && (
        <div className="onboarding-content onboarding-confirm">
          <div className="onboarding-confirm-icon" style={{ background: config.accentColor + "12", border: `2px solid ${config.accentColor}22` }}>
            {(() => { const Icon = config.overviewIcon; return <Icon className="w-10 h-10" style={{ color: config.accentColor }} />; })()}
          </div>

          <h1 className="onboarding-title">Your {config.name} workspace is ready</h1>
          <p className="onboarding-subtitle">{config.tagline}</p>

          <div className="onboarding-modules-preview">
            <div className="onboarding-modules-label">Modules included in your workspace</div>
            <div className="onboarding-modules-list">
              {config.navItems.filter((n) => n.href !== "/settings").map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.href} className="onboarding-module-chip" style={{ borderColor: config.accentColor + "33", color: config.accentColor, background: config.accentColor + "08" }}>
                    <Icon className="w-3.5 h-3.5" />
                    {item.label}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="onboarding-actions">
            <button className="onboarding-btn-secondary" onClick={() => setStep(2)}>Back</button>
            <button
              className="onboarding-btn-primary"
              style={{ background: config.accentColor }}
              onClick={handleFinish}
              disabled={saving}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
              {saving ? "Launching..." : `Launch ${config.name} Workspace`}
              {!saving && <ArrowRight className="w-4 h-4 inline ml-1" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
