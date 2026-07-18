"use client";

import { CampaignBarChart } from "./charts";
import type { UpsellCampaignsResponse } from "../../lib/data";

export function UpsellCampaignsClient({ data }: { data: UpsellCampaignsResponse }) {
  const hasData = data.total > 0;

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Upsell Campaigns</h1>
            <p className="page-subtitle">Offer performance from the automation engine — last 7 days</p>
          </div>
          <span className="px-3 py-2 rounded-lg border border-line text-sm text-fg-muted">Last 7 days</span>
        </div>
      </div>

      {!hasData && (
        <div className="card mb-4" style={{ background: "#f8fafc" }}>
          <p className="text-sm text-fg-muted">No offers generated yet. Rows populate as the upsell automation queues offers and customers convert.</p>
        </div>
      )}

      {/* Bar chart */}
      <div className="card mb-4">
        <h3 className="card-title">Weekly Campaign Activity</h3>
        <div className="flex items-center gap-4 text-xs text-fg-muted mb-3">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent inline-block" />Offers queued</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-warn-solid inline-block" />Conversions</span>
        </div>
        <CampaignBarChart data={data.weeklyData} />
      </div>

      {/* Campaign Performance Log */}
      <div className="card">
        <h3 className="card-title">Offer Performance by Type</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Offer Type</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Conversion</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="text-sm font-semibold text-fg">{item.name}</div>
                    <div className="text-xs text-fg-muted">Trigger: {item.trigger}</div>
                  </td>
                  <td>
                    <span className={`badge ${item.status === "Active" ? "badge-green" : "badge-amber"} flex items-center gap-1 w-fit`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${item.status === "Active" ? "bg-ok-solid" : "bg-warn-solid"}`} />
                      {item.status}
                    </span>
                  </td>
                  <td className="font-semibold text-fg">{item.recipients.toLocaleString()}</td>
                  <td>
                    <span className={`font-semibold text-sm ${item.conversionRate >= 30 ? "text-ok" : "text-fg-muted"}`}>
                      {item.conversionRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="font-semibold text-fg">₹{item.revenueInr.toLocaleString("en-IN")}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr><td colSpan={5} className="text-sm text-fg-muted py-6 text-center">No offers yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-line">
          <span className="text-sm text-fg-muted">SHOWING {data.items.length} OF {data.total} OFFER TYPES</span>
        </div>
      </div>
    </div>
  );
}
