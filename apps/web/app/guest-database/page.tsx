import Link from "next/link";
import { fetchGuests } from "../../lib/data";
import { Search, Download, UserPlus, Star } from "lucide-react";

export const dynamic = "force-dynamic";

const segmentBadge: Record<string, string> = {
  VIP: "badge-amber",
  Business: "badge-blue",
  Family: "badge-green",
  Solo: "badge-slate",
  Couple: "badge-purple"
};

const statusBadge: Record<string, string> = {
  ACTIVE: "badge-green",
  "CHECK-OUT": "badge-slate",
  UPCOMING: "badge-amber"
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function GuestDatabasePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = searchParams ? await searchParams : {};
  const search = typeof q.search === "string" ? q.search : undefined;

  let guests: Awaited<ReturnType<typeof fetchGuests>> | null = null;
  let error = "";
  try {
    guests = await fetchGuests({ search, limit: 20 });
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load guests";
  }

  const items = guests?.items ?? [];
  const total = guests?.page?.total ?? 0;

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Guest Database</h1>
            <p className="page-subtitle">Managing {total.toLocaleString()} sovereign entries across all tiers.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
            <button className="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-1.5" style={{ background: "#0f766e" }}>
              <UserPlus className="w-3.5 h-3.5" /> Add New Guest
            </button>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* KPIs */}
      <div className="kpi-grid-3 mb-5">
        <div className="card">
          <div className="kpi-label">Total Records</div>
          <div className="kpi-value mt-1.5">{total.toLocaleString()}</div>
          <div className="kpi-delta up mt-1">+1.2%</div>
        </div>
        <div className="card">
          <div className="kpi-label">New This Month</div>
          <div className="kpi-value mt-1.5">324</div>
          <div className="mt-1"><span className="badge badge-green text-xs">On Target</span></div>
        </div>
        <div className="card" style={{ background: "#0f2d3d", color: "#fff" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "#7ab8d4" }}>Repeat Guest Rate</div>
          <div className="text-2xl font-bold mt-1.5 text-white flex items-center gap-2">42% <span className="text-emerald-400 text-sm">↑</span></div>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="card mb-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <form method="GET">
              <input name="search" defaultValue={search ?? ""} placeholder="Search by name, email or booking ID..."
                className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent" />
            </form>
          </div>
          <div className="flex items-center gap-2">
            <select className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-600 focus:outline-none">
              <option>All Segments</option>
              <option>VIP</option>
              <option>Business</option>
              <option>Family</option>
              <option>Solo</option>
            </select>
            <select className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-600 focus:outline-none">
              <option>Any Time</option>
              <option>Last 30 Days</option>
              <option>Last Quarter</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Guest Name</th>
                <th>Status</th>
                <th>Segment</th>
                <th>Last Stay</th>
                <th>Visits</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-white text-xs font-semibold">
                        {g.fullName.split(" ").map(w => w[0]).join("").slice(0, 2)}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                          {g.fullName}
                          {g.segment === "VIP" && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                        </div>
                        <div className="text-xs text-slate-400">{g.phoneE164}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className={`badge ${statusBadge[g.status] ?? "badge-slate"}`}>{g.status}</span></td>
                  <td>
                    <span className={`badge ${segmentBadge[g.segment] ?? "badge-slate"} flex items-center gap-1`}>
                      {g.segment === "VIP" && <Star className="w-2.5 h-2.5 fill-current" />}
                      {g.segment}
                    </span>
                  </td>
                  <td className="text-slate-600 text-sm">{formatDate(g.lastStay)}</td>
                  <td className="font-semibold text-slate-700">{g.visitCount}</td>
                  <td>
                    <Link href={`/guest-database/${g.id}`} className="text-sm font-medium" style={{ color: "var(--color-teal)" }}>View Profile</Link>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">No guests found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
            <span className="text-sm text-slate-500">Showing 1 to {Math.min(items.length, total)} of {total.toLocaleString()} sovereign guests</span>
            <div className="flex items-center gap-1">
              {[1,2,3].map(p => (
                <button key={p} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === 1 ? "text-white" : "text-slate-600 hover:bg-slate-100"}`} style={p === 1 ? { background: "#0f766e" } : {}}>{p}</button>
              ))}
              <span className="text-slate-400 px-1">...</span>
              <button className="w-8 h-8 rounded-lg text-sm text-slate-600 hover:bg-slate-100">{Math.ceil(total / 20)}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
