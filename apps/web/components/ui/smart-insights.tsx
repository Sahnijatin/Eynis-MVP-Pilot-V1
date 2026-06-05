"use client";

import { useEffect, useState } from "react";
import { Sparkles, AlertCircle, TrendingUp, Star, Zap, RefreshCw } from "lucide-react";
import { getIndustryConfig } from "../../lib/industry-config";

const PROVIDER_META = {
  claude: {
    label: "Claude",
    accent: "#0f766e",
    accentLight: "rgba(15,118,110,0.15)",
    accentBorder: "rgba(15,118,110,0.3)",
    glyph: "✦"
  },
  openai: {
    label: "GPT-4o",
    accent: "#10a37f",
    accentLight: "rgba(16,163,127,0.15)",
    accentBorder: "rgba(16,163,127,0.3)",
    glyph: "⬡"
  }
} as const;

type Provider = "claude" | "openai";

interface Insights {
  headline: string;
  operationalAlerts: string[];
  revenueHighlight: string;
  experienceNote: string;
  topPriority: string;
}

interface InsightsResponse {
  ok: boolean;
  provider?: string;
  insights?: Insights;
  generatedAt?: string;
  error?: string;
}

interface Availability {
  ok: boolean;
  claude: boolean;
  openai: boolean;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
}

export function SmartInsights({ industry }: { industry?: string | null }) {
  const [provider, setProvider] = useState<Provider>("claude");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Learn which providers are configured so the toggle can show on/off state.
  // No AI call happens here — insights are generated only on click.
  useEffect(() => {
    let active = true;
    fetch("/api/smart-insights", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: Availability) => {
        if (!active) return;
        setAvailability(data);
        // Default to whichever provider is actually available.
        if (!data.claude && data.openai) setProvider("openai");
      })
      .catch(() => active && setAvailability({ ok: false, claude: false, openai: false }));
    return () => { active = false; };
  }, []);

  const entity = getIndustryConfig(industry).terminology.entity;
  const meta = PROVIDER_META[provider];

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/smart-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
        cache: "no-store"
      });
      const data = (await res.json()) as InsightsResponse;
      if (!data.ok || !data.insights) {
        const msg = data.error?.includes("not configured")
          ? `Set ${provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} to enable ${meta.label} insights.`
          : data.error ?? "Unable to generate insights";
        setError(msg);
        setInsights(null);
      } else {
        setInsights(data.insights);
        setGeneratedAt(data.generatedAt ?? new Date().toISOString());
      }
    } catch {
      setError("Unable to reach AI service");
      setInsights(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card mb-5" style={{ background: "linear-gradient(135deg, #0f2027 0%, #142032 100%)", border: "1px solid #1c3a52" }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(15,118,110,0.25)" }}>
            <Sparkles className="w-4 h-4 text-teal-400" />
          </div>
          <span className="text-xs font-semibold text-teal-400 uppercase tracking-wider">Smart Insights</span>
          {generatedAt && (
            <span className="text-[10px] text-slate-500">· updated {formatTimestamp(generatedAt)}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Provider toggle (preserved) */}
          <div className="flex items-center gap-1">
            {(["claude", "openai"] as const).map((p) => {
              const pm = PROVIDER_META[p];
              const isActive = provider === p;
              const isAvailable = availability ? (p === "claude" ? availability.claude : availability.openai) : true;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => isAvailable && setProvider(p)}
                  disabled={!isAvailable}
                  title={isAvailable ? `Use ${pm.label}` : `${pm.label} not configured`}
                  className={[
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
                    isActive ? "bg-teal-700 text-white" : "text-slate-400 hover:text-slate-200 hover:bg-slate-700",
                    !isAvailable ? "opacity-50 cursor-not-allowed" : ""
                  ].join(" ")}
                >
                  <span className="text-[10px] font-bold tracking-tight">{pm.glyph}</span>
                  {pm.label}
                  {!isAvailable && <span className="text-[9px] text-slate-500 font-normal">(off)</span>}
                </button>
              );
            })}
          </div>

          {/* Generate on demand */}
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-60"
            style={{ background: meta.accent }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Generating…" : insights ? "Regenerate" : "Generate insights"}
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <InsightsSkeleton />
      ) : error ? (
        <div className="mt-3 px-1 py-3 text-xs text-amber-300/90 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </div>
      ) : insights ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-white mb-3 leading-relaxed">{insights.headline}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Operational Alerts */}
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <AlertCircle className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] text-amber-400 uppercase tracking-wide font-semibold">Operational</span>
              </div>
              <ul className="space-y-1">
                {insights.operationalAlerts.map((alert, i) => (
                  <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                    <span className="text-amber-500 mt-0.5 shrink-0">•</span>
                    {alert}
                  </li>
                ))}
              </ul>
            </div>

            {/* Revenue + Experience */}
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <TrendingUp className="w-3 h-3 text-emerald-400" />
                  <span className="text-[10px] text-emerald-400 uppercase tracking-wide font-semibold">Revenue</span>
                </div>
                <p className="text-xs text-slate-300">{insights.revenueHighlight}</p>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <Star className="w-3 h-3 text-blue-400" />
                  <span className="text-[10px] text-blue-400 uppercase tracking-wide font-semibold">{entity} Experience</span>
                </div>
                <p className="text-xs text-slate-300">{insights.experienceNote}</p>
              </div>
            </div>

            {/* Top Priority */}
            <div className="p-3 rounded-xl" style={{ background: meta.accentLight, border: `1px solid ${meta.accentBorder}` }}>
              <div className="flex items-center gap-1 mb-1.5">
                <Zap className="w-3 h-3" style={{ color: meta.accent }} />
                <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: meta.accent }}>Top Priority</span>
              </div>
              <p className="text-xs text-white font-medium leading-relaxed">{insights.topPriority}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 px-1 py-3 text-xs text-slate-400">
          Generate AI insights from your live operational data — open requests, sentiment, and revenue when a source is connected.
        </div>
      )}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="mt-3 animate-pulse">
      <div className="h-4 w-3/4 bg-slate-600 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-2.5 w-16 bg-slate-700 rounded" />
            <div className="h-2 w-full bg-slate-800 rounded" />
            <div className="h-2 w-4/5 bg-slate-800 rounded" />
            <div className="h-2 w-3/5 bg-slate-800 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
