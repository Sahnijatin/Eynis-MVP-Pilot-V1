import { Card, PageHeader, Badge } from "../ds";
import type { ContactIntelRow } from "../../lib/data";

// Real Client Intelligence for manufacturing (Phase 7): every row computed from
// live quotes and orders — no sample data.

const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: Math.round(paise) % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

const daysSince = (iso: string | null): number | null => {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600_000));
};

export function CustomersIntel({ items, entityLabel }: { items: ContactIntelRow[]; entityLabel: string }) {
  return (
    <div>
      <PageHeader title={entityLabel} subtitle="Commercial picture per client — accepted value, pending quotes, open orders." />
      <Card>
        <div style={{ overflowX: "auto" }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748b" }}>
                <th style={{ padding: "8px 10px" }}>Client</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Won value</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Wins</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Pending quotes</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Open orders</th>
                <th style={{ padding: "8px 10px" }}>Last win</th>
                <th style={{ padding: "8px 10px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>
                  No client activity yet — send and win quotes and this fills in automatically.
                </td></tr>
              )}
              {items.map((c) => {
                const days = daysSince(c.lastAcceptedAt);
                const atRisk = days !== null && days > 60 && c.openOrders === 0 && c.pendingQuotes === 0;
                return (
                  <tr key={c.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ fontWeight: 500 }}>{c.fullName}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>{c.phoneE164}{c.email ? ` · ${c.email}` : ""}</div>
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{c.acceptedTotalPaise > 0 ? rupees(c.acceptedTotalPaise) : "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{c.acceptedCount || "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{c.pendingQuotes || "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{c.openOrders || "—"}</td>
                    <td style={{ padding: "8px 10px", color: "#64748b" }}>{days === null ? "—" : days === 0 ? "today" : `${days}d ago`}</td>
                    <td style={{ padding: "8px 10px" }}>
                      {atRisk
                        ? <Badge tone="warning">At risk</Badge>
                        : c.openOrders > 0
                          ? <Badge tone="success">In production</Badge>
                          : c.pendingQuotes > 0
                            ? <Badge tone="accent">Deciding</Badge>
                            : <Badge tone="neutral">Idle</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
