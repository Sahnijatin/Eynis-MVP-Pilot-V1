import { fetchRevenueAnalytics } from "../../lib/data";
import { AlertTriangle, Calendar } from "lucide-react";
import { RevenueBarChart, DonutChart } from "../../components/ui/charts";

export const dynamic = "force-dynamic";

const offerLabels: Record<string, string> = {
  room_upgrade: "Luxury Suite Upgrade",
  late_checkout: "4PM Late Checkout",
  fnb_offer: "Candlelight Terrace Dinner",
  spa_offer: "Signature Spa Therapy",
  airport_transfer: "Executive Airport Transfer"
};

const staticTopOffers = [
  { label: "Luxury Suite Upgrade", cr: 42, good: true },
  { label: "Executive Airport Transfer", cr: 40, good: true },
  { label: "Candlelight Terrace Dinner", cr: 38, good: true },
  { label: "Signature Spa Therapy", cr: 36, good: true },
  { label: "4PM Late Checkout", cr: 22, good: false },
  { label: "Complimentary Mini-Bar", cr: 18, good: false },
  { label: "Anniversary Decoration", cr: 45, good: true },
  { label: "Private Yoga Session", cr: 12, good: false }
];

export default async function RevenueIntelligencePage() {
  let data: Awaited<ReturnType<typeof fetchRevenueAnalytics>> | null = null;
  let error = "";
  try {
    data = await fetchRevenueAnalytics();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load revenue data";
  }

  const totals = data?.totals ?? {
    totalUpsellInr: 234500,
    acceptedOffers: 42,
    sentOffers: 118,
    lateCheckoutInr: 48000,
    leftOnTableInr: 78200
  };
  const funnel = data?.funnel ?? { triggered: 12402, sent: 10540, opened: 6324, accepted: 2213, revenueInr: 420000 };
  const topOffers = data?.topConvertingOffers ?? [];

  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const barData = days.map((day, i) => ({
    day,
    upgrades: 800 + i * 200,
    lateCO: 300 + i * 80,
    fnb: 400 + i * 120
  }));

  const segmentData = [
    { name: "Business (45%)", value: 45, color: "#0f766e" },
    { name: "Families (25%)", value: 25, color: "#14b8a6" },
    { name: "Couples (20%)", value: 20, color: "#f59e0b" },
    { name: "Solo (10%)", value: 10, color: "#e2e8f0" }
  ];

  const convRate = totals.sentOffers > 0
    ? ((totals.acceptedOffers / totals.sentOffers) * 100).toFixed(1)
    : "35.6";

  const displayOffers = topOffers.length > 0
    ? topOffers.map((o) => ({ label: offerLabels[o.offerType] ?? o.offerType, cr: Math.round(o.conversionRate * 10) / 10, good: o.conversionRate >= 0.3 }))
    : staticTopOffers;

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Revenue Intelligence</h1>
            <p className="page-subtitle">Track every rupee captured by Eynis automations</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-4 py-2 text-sm font-semibold rounded-lg text-white" style={{ background: "#0f766e" }}>Last 30 Days</button>
            <button className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Last Quarter</button>
            <button className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Custom Range
            </button>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* KPI row */}
      <div className="kpi-grid-5 mb-5">
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="kpi-label">Total Upsell</div>
            <span className="badge badge-green text-[10px]">+12.4%</span>
          </div>
          <div className="kpi-value mt-1.5">₹{totals.totalUpsellInr.toLocaleString("en-IN")}</div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="kpi-label">Upgrade Conv.</div>
            <span className="badge badge-teal text-[10px]">{convRate}% CR</span>
          </div>
          <div className="kpi-value mt-1.5">{totals.acceptedOffers}/{totals.sentOffers}</div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="kpi-label">Late Checkout</div>
            <span className="badge badge-amber text-[10px]">+₹4,200</span>
          </div>
          <div className="kpi-value mt-1.5">₹{totals.lateCheckoutInr.toLocaleString("en-IN")}</div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="kpi-label">F&B Offers</div>
            <span className="badge badge-green text-[10px]">Active</span>
          </div>
          <div className="kpi-value mt-1.5">₹1,12,000</div>
        </div>
        <div className="card" style={{ borderLeft: "3px solid #ef4444" }}>
          <div className="flex items-start justify-between">
            <div className="kpi-label text-red-500">Left on Table</div>
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="kpi-value mt-1.5 text-red-600">₹{totals.leftOnTableInr.toLocaleString("en-IN")}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <h3 className="card-title">Revenue by Automation Type</h3>
          <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-700 inline-block" />Upgrades</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-400 inline-block" />Late Checkouts</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />F&B Offers</span>
          </div>
          <RevenueBarChart data={barData} />
        </div>
        <div className="card">
          <h3 className="card-title">Top Converting Offers</h3>
          <div className="space-y-3">
            {displayOffers.slice(0, 8).map((o, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm text-slate-700">{o.label}</span>
                <span className={`text-sm font-semibold ${o.good ? "text-emerald-600" : "text-slate-400"}`}>{o.cr}% CR</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Funnel + Segment */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2">
          <h3 className="card-title">Conversion Funnel</h3>
          <div className="grid grid-cols-5 gap-2 mb-6">
            {[
              { label: "TRIGGERS", value: funnel.triggered.toLocaleString() },
              { label: "SENT", value: funnel.sent.toLocaleString() },
              { label: "OPENED", value: funnel.opened.toLocaleString() },
              { label: "ACCEPTED", value: funnel.accepted.toLocaleString() },
              { label: "REVENUE", value: `₹${(funnel.revenueInr / 100000).toFixed(1)}L` }
            ].map((f) => (
              <div key={f.label} className="text-center p-4 rounded-lg bg-teal-50 border border-teal-100">
                <div className="text-[10px] font-semibold text-teal-600 uppercase tracking-wider mb-1">{f.label}</div>
                <div className="text-xl font-bold text-slate-800">{f.value}</div>
              </div>
            ))}
          </div>
          <h3 className="card-title">Best Performing Time Slots</h3>
          <div className="space-y-2">
            {["8 AM","12 PM","4 PM","8 PM"].map((t, i) => (
              <div key={t} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-12">{t}</span>
                <div className="flex-1 progress-track">
                  <div className="progress-fill" style={{ width: `${[40, 70, 90, 60][i]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">Revenue by Guest Segment</h3>
          <DonutChart data={segmentData} total="₹4.2L" label="TOTAL" />
          <div className="space-y-2 mt-2">
            {segmentData.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: s.color }} />
                {s.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
