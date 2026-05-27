"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { INDUSTRY_CONFIGS, type Industry } from "../../lib/industry-config";
import { Loader2, CheckCircle } from "lucide-react";

const INDUSTRIES = Object.values(INDUSTRY_CONFIGS);

export function ChangeIndustry({ currentIndustry }: { currentIndustry: string }) {
  const { user } = useUser();
  const [selected, setSelected] = useState<Industry>(currentIndustry as Industry || "hospitality");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    await user.update({
      unsafeMetadata: { ...user.unsafeMetadata, industry: selected, onboardingCompleted: true }
    });
    // Full reload so server re-renders with fresh Clerk session data
    window.location.href = "/dashboard";
  }

  return (
    <div>
      <div className="text-sm font-semibold text-slate-700 mb-3">Your Industry Workspace</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        {INDUSTRIES.map((ind) => {
          const Icon = ind.overviewIcon;
          return (
            <button
              key={ind.id}
              onClick={() => setSelected(ind.id)}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${selected === ind.id ? "shadow-sm" : "border-slate-200 hover:border-slate-300"}`}
              style={selected === ind.id ? { borderColor: ind.accentColor, background: ind.accentColor + "08" } : {}}
            >
              <Icon className="w-5 h-5 shrink-0" style={{ color: selected === ind.id ? ind.accentColor : "#94a3b8" }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-800">{ind.name}</div>
                <div className="text-xs text-slate-400 truncate">{ind.tagline}</div>
              </div>
              {selected === ind.id && <CheckCircle className="w-4 h-4 shrink-0" style={{ color: ind.accentColor }} />}
            </button>
          );
        })}
      </div>
      <button
        onClick={handleSave}
        disabled={saving || selected === currentIndustry}
        className="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-2 disabled:opacity-50 transition-all"
        style={{ background: INDUSTRY_CONFIGS[selected]?.accentColor ?? "#0f766e" }}
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {saving ? "Switching..." : selected === currentIndustry ? "Current workspace" : `Switch to ${INDUSTRY_CONFIGS[selected]?.name}`}
      </button>
    </div>
  );
}
