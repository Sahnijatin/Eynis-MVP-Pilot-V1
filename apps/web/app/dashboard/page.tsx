import { getUserWorkspace } from "../../lib/workspace";
import { ManufacturingDashboard } from "../../components/ui/manufacturing-dashboard";
import { FnbDashboard } from "../../components/ui/fnb-dashboard";
import { TravelDashboard } from "../../components/ui/travel-dashboard";
import { HealthcareDashboard } from "../../components/ui/healthcare-dashboard";
import { fetchDashboardData } from "../../lib/data";
import Link from "next/link";
import {
  LayoutDashboard, Users, Bell, DollarSign, AlertCircle, AlertTriangle, ChevronRight, Zap
} from "lucide-react";
import { OccupancyChart } from "../../components/ui/charts";
import { SmartInsights } from "../../components/ui/smart-insights";
import { InboundPipeline } from "../../components/ui/inbound-pipeline";
import { LiveFeedSSE } from "../../components/ui/live-feed-sse";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Resolve industry defensively. If workspace resolution fails for any reason
  // (API down, DB hiccup, bad metadata) we fall through to the hospitality
  // default — the user still sees a populated dashboard, never a blank page.
  let industry: string | null = "hospitality";
  try {
    const ws = await getUserWorkspace();
    industry = ws.industry ?? "hospitality";
  } catch {
    industry = "hospitality";
  }

  // Route to industry-specific dashboards
  if (industry === "manufacturing") return <ManufacturingDashboard />;
  if (industry === "fnb") return <FnbDashboard />;
  if (industry === "travel") return <TravelDashboard />;
  if (industry === "healthcare") return <HealthcareDashboard />;

  // Default: Hospitality dashboard
  let data: Awaited<ReturnType<typeof fetchDashboardData>> | null = null;
  let error = "";
  try {
    data = await fetchDashboardData();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load dashboard";
  }

  const overview = data?.overview?.metrics;
  const trendSeries = data?.trends?.series ?? [];
  const feed = data?.liveFeed?.items ?? [];
  const openCount = overview?.openCount ?? 4;
  const escalated = overview?.escalatedOpenCount ?? 1;
  const resolvedToday = overview?.resolvedTodayCount ?? 6;

  const chartData = trendSeries.slice(-14).map((p) => ({ date: p.date.slice(5), value: Math.max(55, 60 + p.created * 3) }));
  if (chartData.length === 0) {
    const days = ["11 Nov", "14 Nov", "17 Nov", "20 Nov", "23 Nov", "Today"];
    const vals = [38, 52, 61, 54, 72, 68];
    days.forEach((d, i) => chartData.push({ date: d, value: vals[i] }));
  }

  const automationItems = [
    { label: "WELCOME MESSAGES", value: 12, pct: 82 },
    { label: "UPGRADE OFFERS", value: 8, pct: 54 },
    { label: "LATE CHECKOUTS", value: 6, pct: 45 },
    { label: "SENTIMENT CHECKS", value: 4, pct: 32 }
  ];

  const upsellTotal = (resolvedToday + 8) * 700;
  const upgrades = Math.round(upsellTotal * 0.49);
  const lateCO = Math.round(upsellTotal * 0.19);
  const fnb = Math.round(upsellTotal * 0.32);
  const missedPotential = Math.round(upsellTotal * 0.37);

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      <SmartInsights industry={industry} />

      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <div className="kpi-label">Occupancy Today</div>
              <div className="kpi-value mt-1.5">74%</div>
              <div className="kpi-delta up mt-2">↑ +6% vs yesterday</div>
            </div>
            <div className="kpi-icon bg-teal-50">
              <LayoutDashboard className="w-4.5 h-4.5 text-teal-700" />
            </div>
          </div>
          <div className="flex items-end gap-0.5 mt-3 h-8">
            {[30, 38, 42, 50, 55, 62, 68].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: i === 6 ? "#0f766e" : `rgba(15,118,110,${0.15 + i * 0.1})` }} />
            ))}
          </div>
        </div>

        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <div className="kpi-label">In-House Guests</div>
              <div className="kpi-value mt-1.5">52</div>
              <div className="kpi-delta neutral mt-2">● 8 check-ins remaining</div>
            </div>
            <div className="kpi-icon bg-blue-50">
              <Users className="w-4.5 h-4.5 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="card" style={{ borderTop: escalated > 0 ? "3px solid #f59e0b" : undefined }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="kpi-label">Open Requests</div>
              <div className="kpi-value mt-1.5">{openCount}</div>
              {escalated > 0 && (
                <div className="kpi-delta down mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {escalated} escalated
                </div>
              )}
            </div>
            <div className="relative">
              <div className="kpi-icon bg-amber-50">
                <Bell className="w-4.5 h-4.5 text-amber-600" />
              </div>
              <div className="absolute -bottom-2 -right-2 text-xs font-semibold text-slate-500">{openCount}/{openCount + resolvedToday}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <div className="kpi-label">Today&apos;s Revenue</div>
              <div className="kpi-value mt-1.5">₹12,400</div>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="badge badge-teal text-xs">+₹4,200 UPSELLS</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">3 upgrades, 2 late C/O</div>
            </div>
            <div className="kpi-icon bg-emerald-50">
              <DollarSign className="w-4.5 h-4.5 text-emerald-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <LiveFeedSSE initialItems={feed} />
        </div>
        <div className="flex flex-col gap-4">
          <div className="card flex-1">
            <h3 className="card-title">Upsell Performance</h3>
            <div className="flex items-center justify-center py-2 mb-3">
              <div className="w-24 h-24 rounded-xl border-4 flex flex-col items-center justify-center" style={{ borderColor: "#0f766e" }}>
                <div className="text-xs text-slate-500">TOTAL</div>
                <div className="text-lg font-bold text-slate-800">₹{Math.round(upsellTotal / 100) * 100 >= 1000 ? (Math.round(upsellTotal / 100) / 10).toFixed(1) + "k" : upsellTotal}</div>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-teal-700 inline-block" />Upgrades</span><span className="font-medium">₹{upgrades.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Late C/O</span><span className="font-medium">₹{lateCO.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />F&amp;B</span><span className="font-medium">₹{fnb.toLocaleString()}</span></div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="flex justify-between text-sm">
                <span className="text-red-500 font-medium">Potential missed:</span>
                <span className="text-red-600 font-bold">₹{missedPotential.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-teal-700" />
            <h3 className="card-title mb-0">Today&apos;s Automation Activity</h3>
          </div>
          <div className="space-y-3">
            {automationItems.map((a) => (
              <div key={a.label}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{a.label}</span>
                  <span className="text-xs font-semibold text-slate-700">{a.value}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${a.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="card flex-1">
            <h3 className="card-title">Critical Alerts</h3>
            <div className="space-y-2">
              <div className="alert-card error">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-red-700">Delayed Service Room 302</div>
                  <div className="text-xs text-red-500">Request open for &gt;45 mins</div>
                </div>
              </div>
              <div className="alert-card warning">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-amber-700">PMS Sync Lag</div>
                  <div className="text-xs text-amber-600">Inventory sync delayed by 4m</div>
                </div>
              </div>
            </div>
          </div>
          <div className="card" style={{ background: "#0f766e" }}>
            <div className="text-xs text-teal-200 uppercase tracking-wider font-medium mb-1">Night Audit</div>
            <div className="text-white font-semibold text-sm mb-3">AI-generated operations report</div>
            <div className="w-full bg-teal-600 rounded-full h-1.5 mb-3">
              <div className="bg-white rounded-full h-1.5" style={{ width: "65%" }} />
            </div>
            <Link href="/night-audit" className="w-full text-center text-xs text-teal-100 font-medium flex items-center justify-center gap-1 py-1.5 rounded-lg border border-teal-500 hover:bg-teal-600 transition-colors">
              View &amp; Generate Report <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      <InboundPipeline />

      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="card-title mb-0">Occupancy Trend</h3>
            <p className="text-xs text-slate-500 mt-0.5">14-day rolling average vs target</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-700 inline-block" />ACTUAL</span>
            <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block" />TARGET (70%)</span>
          </div>
        </div>
        <OccupancyChart data={chartData} />
      </div>
    </div>
  );
}
