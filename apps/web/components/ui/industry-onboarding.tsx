"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { INDUSTRY_CONFIGS, flattenModuleLinks, type Industry } from "../../lib/industry-config";
import { CheckCircle, ArrowRight, Loader2, Check } from "lucide-react";

const INDUSTRIES = Object.values(INDUSTRY_CONFIGS);

export function IndustryOnboarding({ allowAdditional = false }: { allowAdditional?: boolean }) {
  const { user, isLoaded } = useUser();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedIndustry, setSelectedIndustry] = useState<Industry | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [propertyName, setPropertyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(true);

  const config = selectedIndustry ? INDUSTRY_CONFIGS[selectedIndustry] : null;

  // Always verify against DB. If user has a DB record (owner or invited), skip the wizard.
  // Clerk metadata alone is not trusted — it can be stale from a deleted hotel.
  useEffect(() => {
    if (!isLoaded || !user) return;
    // Adding an additional workspace: skip the "already onboarded → dashboard"
    // shortcut and show the picker.
    if (allowAdditional) { setIsIdentifying(false); return; }
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) {
      setIsIdentifying(false);
      return;
    }

    fetch(`/api/identify?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then(async (data: { ok: boolean; exists?: boolean; tenantId?: string; role?: string; roleKey?: string | null; industry?: string }) => {
        if (data.ok && data.exists && data.tenantId) {
          // Try to update Clerk metadata as a cache, but never block the redirect on it.
          // The dashboard reads from DB via /api/me, so Clerk metadata is optional.
          user.update({
            unsafeMetadata: {
              ...user.unsafeMetadata,
              tenantId: data.tenantId,
              role: data.role ?? "housekeeping",
              roleKey: data.roleKey ?? null,
              industry: data.industry ?? "hospitality",
              onboardingCompleted: true,
            },
          }).catch(() => { /* Clerk update failed — DB is source of truth, proceed anyway */ });
          window.location.replace("/dashboard");
        } else {
          setIsIdentifying(false);
        }
      })
      .catch(() => setIsIdentifying(false));
  }, [isLoaded, user]);

  if (!isLoaded || isIdentifying) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-7 h-7 animate-spin" />
          <span className="text-sm">Setting up your workspace...</span>
        </div>
      </div>
    );
  }

  async function handleFinish() {
    if (!selectedIndustry || !user) return;
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) return;
    setSaving(true);
    setRegisterError(null);
    try {
      const regRes = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyName: propertyName.trim() || "My Property",
          ownerEmail: email,
          ownerName: ownerName.trim() || user.fullName || undefined,
          industry: selectedIndustry,
        }),
      });
      const regData = (await regRes.json()) as { ok: boolean; tenantId?: string; error?: string };
      if (!regData.ok) {
        setRegisterError(regData.error ?? "Registration failed. Please try again.");
        setSaving(false);
        return;
      }
      // Update Clerk metadata as a cache; don't block redirect if Clerk is slow.
      user.update({
        unsafeMetadata: {
          industry: selectedIndustry,
          onboardingAnswers: answers,
          onboardingCompleted: true,
          tenantId: regData.tenantId,
          role: "owner",
          roleKey: "admin",
        },
      }).catch(() => { /* Clerk update failed — DB has the record, proceed */ });
      // Make the freshly created workspace the active one so the user lands in it
      // (important when adding an additional workspace alongside existing ones).
      if (regData.tenantId) {
        await fetch("/api/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantId: regData.tenantId }),
        }).catch(() => { /* cookie set is best-effort; switcher still works */ });
      }
      window.location.href = "/dashboard";
    } catch {
      setRegisterError("Network error — please try again.");
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
            Your workspace is configured with modules, terminology, and AI models specifically for your industry.
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
          <p className="onboarding-subtitle">Help us personalise your workspace.</p>

          <div className="onboarding-question" style={{ marginBottom: "1.25rem" }}>
            <div className="onboarding-question-label">What is your property or business name?</div>
            <input
              type="text"
              value={propertyName}
              onChange={(e) => setPropertyName(e.target.value)}
              placeholder={`e.g. The Grand ${config?.name ?? "Hotel"}`}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent mt-2"
              style={{ "--tw-ring-color": config?.accentColor ?? "var(--color-primary, #0f766e)" } as React.CSSProperties}
            />
          </div>

          <div className="onboarding-question" style={{ marginBottom: "1.25rem" }}>
            <div className="onboarding-question-label">Your full name</div>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="e.g. Rajnandni Khokar"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent mt-2"
              style={{ "--tw-ring-color": config?.accentColor ?? "var(--color-primary, #0f766e)" } as React.CSSProperties}
            />
          </div>

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
              disabled={config.onboardingQuestions.some((q) => !answers[q.id]) || !propertyName.trim()}
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

          <h1 className="onboarding-title">
            {propertyName.trim() ? propertyName.trim() : `Your ${config.name} workspace`} is ready
          </h1>
          <p className="onboarding-subtitle">{config.tagline}</p>

          <div className="onboarding-modules-preview">
            <div className="onboarding-modules-label">Modules included in your workspace</div>
            <div className="onboarding-modules-list">
              {flattenModuleLinks(config.modules).filter((n) => n.href !== "/settings").map((item) => {
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

          {registerError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg text-center mb-2">
              {registerError}
            </p>
          )}

          <div className="onboarding-actions">
            <button className="onboarding-btn-secondary" onClick={() => { setStep(2); setRegisterError(null); }}>Back</button>
            <button
              className="onboarding-btn-primary"
              style={{ background: config.accentColor }}
              onClick={handleFinish}
              disabled={saving}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
              {saving ? "Creating your workspace..." : `Launch ${config.name} Workspace`}
              {!saving && <ArrowRight className="w-4 h-4 inline ml-1" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
