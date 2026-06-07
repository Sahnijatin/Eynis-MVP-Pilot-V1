import { TrendingUp, AlertTriangle } from "lucide-react";
import { fetchRevenueAnalytics } from "../../lib/data";
import { DateRangeControl } from "../../components/ui/date-range-control";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const prettyType = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Revenue Intelligence — now backed by the real /analytics/revenue-intelligence
// endpoint (#128, replacing the former static mock). Date-range aware via the
// shared DateRangeControl (E-15); renders only what the endpoint actually returns.
export default async function RevenueIntelligencePage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const data = await fetchRevenueAnalytics(sp.from, sp.to);
  const { totals, byAutomationType, topConvertingOffers, funnel } = data;
  const convRate = totals.sentOffers > 0 ? ((totals.acceptedOffers / totals.sentOffers) * 100).toFixed(1) : "0.0";
  const hasData = totals.sentOffers > 0;
  const maxRevenue = Math.max(1, ...byAutomationType.map((a) => a.revenueInr));
  const rangeLabel = sp.from && sp.to ? `${sp.from} → ${sp.to}` : "all time";

  return (
    <div>
      <div className="page-header">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="page-title">Revenue Intelligence</h1>
            <p className="page-subtitle">Revenue captured by your automations — {rangeLabel}</p>
          </div>
          <DateRangeControl defaultPreset="30d" />
        </div>
      </div>

      {!hasData && (
        <div className="card mb-5" style={{ background: "#f8fafc" }}>
          <p className="text-sm text-slate-500">No offer activity in this window yet. Figures populate as upsell offers are sent and accepted.</p>
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderLeft: "3px solid var(--color-primary, #0f766e)" }}>
          <div className="kpi-label">Total Upsell Revenue</div>
          <div className="kpi-value mt-1.5">{inr(totals.totalUpsellInr)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Offers Accepted</div>
          <div className="kpi-value mt-1.5">{totals.acceptedOffers}<span className="text-lg text-slate-400 font-normal"> / {totals.sentOffers}</span></div>
          <div className="kpi-label mt-1">offers sent</div>
        </div>
        <div className="card">
          <div className="kpi-label">Conversion Rate</div>
          <div className="kpi-value mt-1.5">{convRate}%</div>
        </div>
        <div className="card" style={{ borderLeft: "3px solid #ef4444" }}>
          <div className="flex items-start justify-between">
            <div className="kpi-label text-red-500">Left on Table</div>
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="kpi-value mt-1.5 text-red-600">{inr(totals.leftOnTableInr)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue by automation type */}
        <div className="card lg:col-span-2">
          <h3 className="card-title">Revenue by Automation Type</h3>
          {byAutomationType.length === 0 ? (
            <p className="text-sm text-slate-400">No revenue recorded in this window.</p>
          ) : (
            <div className="space-y-3 mt-2">
              {byAutomationType.map((a) => (
                <div key={a.key}>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-medium text-slate-700">{prettyType(a.key)}</span>
                    <span className="text-sm text-slate-500">{inr(a.revenueInr)} · {a.accepted}/{a.sent}</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${(a.revenueInr / maxRevenue) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top converting offers */}
        <div className="card">
          <h3 className="card-title">Top Converting Offers</h3>
          {topConvertingOffers.length === 0 ? (
            <p className="text-sm text-slate-400">No offers yet.</p>
          ) : (
            <div className="space-y-3 mt-2">
              {topConvertingOffers.map((o) => (
                <div key={o.offerType} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">{prettyType(o.offerType)}</span>
                  <span className="text-sm font-semibold text-emerald-600">{o.conversionRate}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Conversion funnel */}
      <div className="card mt-4">
        <h3 className="card-title flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-teal-600" /> Conversion Funnel</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mt-2">
          {[
            { label: "Triggered", value: funnel.triggered.toLocaleString("en-IN") },
            { label: "Sent", value: funnel.sent.toLocaleString("en-IN") },
            { label: "Opened", value: funnel.opened.toLocaleString("en-IN") },
            { label: "Accepted", value: funnel.accepted.toLocaleString("en-IN") },
            { label: "Revenue", value: inr(funnel.revenueInr) },
          ].map((f) => (
            <div key={f.label} className="text-center p-4 rounded-lg bg-teal-50 border border-teal-100">
              <div className="text-[10px] font-semibold text-teal-600 uppercase tracking-wider mb-1">{f.label}</div>
              <div className="text-lg font-bold text-slate-800">{f.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
