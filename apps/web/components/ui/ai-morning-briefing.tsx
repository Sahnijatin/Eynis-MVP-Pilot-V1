import { Suspense } from "react";
import { Sparkles, AlertCircle, TrendingUp, Star, Zap } from "lucide-react";
import { fetchAIProviders, fetchMorningBriefing } from "../../lib/data";

const PROVIDER_META = {
  claude: {
    label: "Claude",
    badge: "Anthropic",
    accent: "#0f766e",
    accentLight: "rgba(15,118,110,0.15)",
    accentBorder: "rgba(15,118,110,0.3)"
  },
  openai: {
    label: "GPT-4o",
    badge: "OpenAI",
    accent: "#10a37f",
    accentLight: "rgba(16,163,127,0.15)",
    accentBorder: "rgba(16,163,127,0.3)"
  }
} as const;

type Provider = "claude" | "openai";

async function BriefingContent({ provider }: { provider: Provider }) {
  const data = await fetchMorningBriefing(provider);
  const meta = PROVIDER_META[provider];

  if (!data.ok || !data.briefing) {
    const msg = data.error?.includes("not configured")
      ? `Set ${provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} to enable ${meta.label} briefings.`
      : data.error ?? "Unable to generate briefing";
    return (
      <div className="px-1 py-3 text-xs text-slate-400 italic">{msg}</div>
    );
  }

  const { briefing } = data;

  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-white mb-3 leading-relaxed">{briefing.headline}</p>
      <div className="grid grid-cols-3 gap-3">
        {/* Operational Alerts */}
        <div>
          <div className="flex items-center gap-1 mb-1.5">
            <AlertCircle className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] text-amber-400 uppercase tracking-wide font-semibold">Operational</span>
          </div>
          <ul className="space-y-1">
            {briefing.operationalAlerts.map((alert, i) => (
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
            <p className="text-xs text-slate-300">{briefing.revenueHighlight}</p>
          </div>
          <div>
            <div className="flex items-center gap-1 mb-1.5">
              <Star className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] text-blue-400 uppercase tracking-wide font-semibold">Guest Experience</span>
            </div>
            <p className="text-xs text-slate-300">{briefing.guestExperienceNote}</p>
          </div>
        </div>

        {/* Top Priority */}
        <div className="p-3 rounded-xl" style={{ background: meta.accentLight, border: `1px solid ${meta.accentBorder}` }}>
          <div className="flex items-center gap-1 mb-1.5">
            <Zap className="w-3 h-3" style={{ color: meta.accent }} />
            <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: meta.accent }}>GM Top Priority</span>
          </div>
          <p className="text-xs text-white font-medium leading-relaxed">{briefing.topPriority}</p>
        </div>
      </div>
    </div>
  );
}

function BriefingSkeleton() {
  return (
    <div className="mt-3 animate-pulse">
      <div className="h-4 w-3/4 bg-slate-600 rounded mb-4" />
      <div className="grid grid-cols-3 gap-3">
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

async function ProviderTabs({
  activeProvider,
  baseHref
}: {
  activeProvider: Provider;
  baseHref: string;
}) {
  const availability = await fetchAIProviders();

  return (
    <div className="flex items-center gap-1">
      {(["claude", "openai"] as const).map((p) => {
        const meta = PROVIDER_META[p];
        const isActive = activeProvider === p;
        const isAvailable = p === "claude" ? availability.claude : availability.openai;
        const href = `${baseHref}?aiProvider=${p}`;

        return (
          <a
            key={p}
            href={href}
            title={isAvailable ? `Switch to ${meta.label}` : `${meta.label} not configured`}
            className={[
              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
              isActive
                ? "bg-teal-700 text-white"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
            ].join(" ")}
          >
            {p === "claude" ? (
              <span className="text-[10px] font-bold tracking-tight">✦</span>
            ) : (
              <span className="text-[10px] font-bold tracking-tight">⬡</span>
            )}
            {meta.label}
            {!isAvailable && <span className="text-[9px] text-slate-500 font-normal">(off)</span>}
          </a>
        );
      })}
    </div>
  );
}

export function AIMorningBriefing({
  provider = "claude",
  baseHref = "/dashboard"
}: {
  provider?: Provider;
  baseHref?: string;
}) {
  return (
    <div className="card mb-5" style={{ background: "linear-gradient(135deg, #0f2027 0%, #142032 100%)", border: "1px solid #1c3a52" }}>
      <div className="flex items-center justify-between mb-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(15,118,110,0.25)" }}>
            <Sparkles className="w-4 h-4 text-teal-400" />
          </div>
          <span className="text-xs font-semibold text-teal-400 uppercase tracking-wider">AI Morning Briefing</span>
        </div>
        <Suspense fallback={
          <div className="flex gap-1">
            {["Claude", "GPT-4o"].map((l) => (
              <div key={l} className="h-6 w-16 bg-slate-700 rounded-lg animate-pulse" />
            ))}
          </div>
        }>
          <ProviderTabs activeProvider={provider} baseHref={baseHref} />
        </Suspense>
      </div>

      <Suspense fallback={<BriefingSkeleton />}>
        <BriefingContent provider={provider} />
      </Suspense>
    </div>
  );
}
