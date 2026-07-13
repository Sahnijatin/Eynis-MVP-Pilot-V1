import { fetchInventory, fetchInventoryYield } from "../../lib/data";
import { InventoryClient } from "../../components/ui/inventory-client";
import { Card } from "../../components/ds";

export const dynamic = "force-dynamic";

const YIELD_WINDOW_DAYS = 90;

// Material Yield for manufacturing — real data end-to-end. Stock/costs come from
// the shared InventoryItem store; the yield table (4.3) computes, per material,
// what the stock ledger says moved (received / used / waste + waste ratio over
// the window) and how much accepted quotes have committed against it.
export default async function MaterialsPage() {
  const [data, yieldData] = await Promise.all([fetchInventory(), fetchInventoryYield(YIELD_WINDOW_DAYS)]);
  const rows = (yieldData.items ?? []).filter(
    (r) => r.receivedQty > 0 || r.usedQty > 0 || r.wasteQty > 0 || r.committedQty > 0,
  );
  return (
    <div>
      <InventoryClient
        initialItems={data.items ?? []}
        heading={{ title: "Materials", subtitle: "Live material stock · unit costs · reorder alerts" }}
      />

      <div className="mt-4">
        <Card>
          <h3 className="card-title">Yield — last {yieldData.windowDays} days</h3>
          <p className="text-xs text-slate-500 mb-3">
            Movement from the stock ledger plus demand committed by accepted quotes. Log usage and waste
            against materials to build up waste-ratio history.
          </p>
          {rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              No movement or committed demand yet — this fills in as you receive, use and quote materials.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "8px 10px" }}>Material</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Received</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Used</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Waste</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Waste %</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Committed (accepted quotes)</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>On hand</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 500 }}>{r.name}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.receivedQty} {r.unit}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.usedQty} {r.unit}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: r.wasteQty > 0 ? "#b45309" : undefined }}>{r.wasteQty} {r.unit}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: r.wasteRatioPct >= 15 ? "#dc2626" : r.wasteRatioPct > 0 ? "#b45309" : undefined }}>
                        {r.wasteRatioPct > 0 ? `${r.wasteRatioPct}%` : "—"}
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.committedQty > 0 ? `${r.committedQty} ${r.unit}` : "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", color: r.status === "critical" ? "#dc2626" : r.status === "warning" ? "#b45309" : undefined }}>
                        {r.stock} {r.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
