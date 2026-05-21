import { fetchUpsellCampaigns } from "../../lib/data";
import { Filter, Download, MoreHorizontal, Pencil } from "lucide-react";
import { CampaignBarChart } from "../../components/ui/charts";

export const dynamic = "force-dynamic";

export default async function UpsellCampaignsPage() {
  let data: Awaited<ReturnType<typeof fetchUpsellCampaigns>> | null = null;
  let error = "";
  try {
    data = await fetchUpsellCampaigns();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load campaigns";
  }

  const items = data?.items ?? [];
  const weeklyData = data?.weeklyData ?? [];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Upsell Campaigns</h1>
        <p className="page-subtitle">Design and monitor campaign performance across all channels.</p>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* Weekly performance bar chart */}
      {weeklyData.length > 0 && (
        <div className="card mb-4">
          <h3 className="card-title">Weekly Campaign Activity</h3>
          <CampaignBarChart data={weeklyData} />
        </div>
      )}

      {/* Campaign Performance Log */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="card-title mb-0">Campaign Performance Log</h3>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5" /> Filter campaigns...
            </button>
            <button className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export PDF
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign Name</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Conversion</th>
                <th>Revenue</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                    <div className="text-xs text-slate-400">Trigger: {item.trigger}</div>
                  </td>
                  <td>
                    <span className={`badge ${item.status === "Active" ? "badge-green" : "badge-amber"} flex items-center gap-1 w-fit`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${item.status === "Active" ? "bg-emerald-500" : "bg-amber-500"}`} />
                      {item.status}
                    </span>
                  </td>
                  <td className="font-semibold text-slate-700">{item.recipients.toLocaleString()}</td>
                  <td>
                    <span className={`font-semibold text-sm ${item.conversionRate >= 30 ? "text-emerald-600" : "text-slate-500"}`}>
                      {item.conversionRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="font-semibold text-slate-700">₹{item.revenueInr.toLocaleString("en-IN")}</td>
                  <td>
                    <div className="flex gap-2">
                      <button className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">No campaigns configured yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {items.length > 0 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
            <span className="text-sm text-slate-500">SHOWING {items.length} OF {items.length} CAMPAIGNS</span>
            <div className="flex items-center gap-1">
              {[1,2,3].map(p => (
                <button key={p} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === 1 ? "text-white" : "text-slate-600 hover:bg-slate-100"}`} style={p === 1 ? { background: "#0f766e" } : {}}>{p}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
