import Link from "next/link";
import { Plane, ChevronRight, Calculator } from "lucide-react";
import { SmartInsights } from "./smart-insights";
import { fetchBookings, fetchQuotes } from "../../lib/data";

// Travel Command Centre (Wave 5) — real data: bookings from the Booking model
// and trip quotes awaiting a decision from the quote engine.

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  in_progress: { label: "In Progress", color: "#1d4ed8", bg: "#eff6ff" },
  confirmed: { label: "Confirmed", color: "#059669", bg: "#d1fae5" },
  pending_visa: { label: "Visa Pending", color: "#d97706", bg: "#fef3c7" },
  urgent: { label: "Action Needed", color: "#dc2626", bg: "#fee2e2" },
  completed: { label: "Completed", color: "#475569", bg: "#f1f5f9" },
  cancelled: { label: "Cancelled", color: "#64748b", bg: "#f1f5f9" },
};

const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN")}`;
const lakh = (paise: number) => { const inr = paise / 100; return inr >= 100000 ? `₹${(inr / 100000).toFixed(1)}L` : rupees(paise); };
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "TBD";

export async function TravelDashboard() {
  const [bookings, quotes] = await Promise.all([fetchBookings(), fetchQuotes()]);

  const live = bookings.items.filter((b) => b.status !== "cancelled" && b.status !== "completed");
  const pipeline = live.reduce((s, b) => s + b.valuePaise, 0);
  const totalPax = live.reduce((s, b) => s + b.pax, 0);
  const weekAhead = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const departingSoon = live
    .filter((b) => b.departureDate && new Date(b.departureDate).getTime() <= weekAhead && new Date(b.departureDate).getTime() >= Date.now() - 24 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.departureDate!).getTime() - new Date(b.departureDate!).getTime());
  const attention = live.filter((b) => b.status === "urgent" || b.status === "pending_visa" || (b.paidPct < 100 && b.departureDate && new Date(b.departureDate).getTime() <= weekAhead)).length;
  const upcoming = [...live].filter((b) => b.departureDate).sort((a, b) => new Date(a.departureDate!).getTime() - new Date(b.departureDate!).getTime()).slice(0, 5);
  const sentQuotes = quotes.items.filter((q) => q.status === "sent");
  const sentValue = sentQuotes.reduce((s, q) => s + (Number(q.totalPaise) || 0), 0);

  const statusCounts = live.reduce<Record<string, number>>((acc, b) => { acc[b.status] = (acc[b.status] ?? 0) + 1; return acc; }, {});
  const statusRows = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <SmartInsights industry="travel" />

      <div className="kpi-grid mb-5">
        <div className="card"><div className="kpi-label">Pipeline Value</div><div className="kpi-value mt-1.5">{lakh(pipeline)}</div><div className="kpi-delta neutral mt-1.5">{live.length} active bookings</div></div>
        <div className="card"><div className="kpi-label">Trip Quotes Awaiting Decision</div><div className="kpi-value mt-1.5">{sentQuotes.length}</div><div className="kpi-delta neutral mt-1.5">{lakh(sentValue)} potential</div></div>
        <div className="card"><div className="kpi-label">Departures This Week</div><div className="kpi-value mt-1.5">{departingSoon.length}</div><div className="kpi-delta neutral mt-1.5">{totalPax} total pax</div></div>
        <div className="card" style={{ borderTop: attention > 0 ? "3px solid #f43f5e" : undefined }}><div className="kpi-label">Action Needed</div><div className="kpi-value mt-1.5">{attention}</div><div className="kpi-delta neutral mt-1.5">visa pending / unpaid</div></div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Plane className="w-4 h-4 text-accent-text" /><h3 className="card-title mb-0">Upcoming Departures</h3></div>
            <Link href="/bookings" className="text-xs text-accent-text font-medium flex items-center gap-1 hover:underline">View all <ChevronRight className="w-3 h-3" /></Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="py-6 text-center text-sm text-fg-subtle">No upcoming departures — new bookings appear here.</div>
          ) : (
            <div className="space-y-2">
              {upcoming.map((b) => {
                const s = STATUS_META[b.status] ?? STATUS_META.in_progress;
                return (
                  <div key={b.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-line">
                    <Plane className="w-4 h-4 text-accent-text shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-fg">{b.clientName}</div>
                      <div className="text-xs text-fg-muted">{b.destination || "—"} · {b.pax} pax</div>
                    </div>
                    <span className="text-xs font-medium text-fg-muted">{fmtDate(b.departureDate)}</span>
                    <span className="badge text-xs" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="card-title mb-3">Bookings by Status</h3>
          {statusRows.length === 0 ? (
            <div className="py-4 text-sm text-fg-subtle">No active bookings yet.</div>
          ) : (
            statusRows.map(([status, count]) => {
              const s = STATUS_META[status] ?? STATUS_META.in_progress;
              const pct = live.length ? Math.round((count / live.length) * 100) : 0;
              return (
                <div key={status} className="mb-3">
                  <div className="flex justify-between text-sm mb-1"><span className="text-fg-muted">{s.label}</span><span className="font-semibold">{count}</span></div>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%`, background: s.color }} /></div>
                </div>
              );
            })
          )}
          <Link href="/quotes" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-fg-muted hover:text-fg">
            <Calculator className="w-4 h-4" /> Build a trip quote <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
