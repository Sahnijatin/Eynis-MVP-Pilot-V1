import Link from "next/link";
import { FileText, Moon, BarChart3, ChevronRight, Plus, Table2, Lock, Users } from "lucide-react";
import { getUserWorkspace } from "../../lib/workspace";
import { fetchReports } from "../../lib/data";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  service_requests: "Service Requests",
  deals: "Deals",
  contacts: "Contacts",
};

// Reports module (E-2 / E-16). Lists the user's saved + shared custom reports
// (built with the report builder) alongside the system reports each industry
// already ships.
export default async function ReportsPage() {
  const { config, industry } = await getUserWorkspace();
  const accent = config.accentColor;
  const { items: reports } = await fetchReports();

  const systemCards: Array<{ icon: typeof FileText; label: string; description: string; href: string }> = [];
  if (industry === "hospitality") {
    systemCards.push({ icon: Moon, label: "Night Audit", description: "AI-generated end-of-day operations report.", href: "/night-audit" });
  }
  systemCards.push({ icon: BarChart3, label: "Revenue & Trends", description: "Performance analytics and trends.", href: "/analytics" });

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: accent + "18" }}>
              <FileText className="w-5 h-5" style={{ color: accent }} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Reports</h1>
              <p className="text-sm text-slate-500">Build custom reports over your data, or open a system report.</p>
            </div>
          </div>
          <Link href="/reports/new" className="px-4 py-2 text-sm font-semibold rounded-lg text-white inline-flex items-center gap-1.5" style={{ background: accent }}>
            <Plus className="w-4 h-4" /> New report
          </Link>
        </div>
      </div>

      {/* Saved (custom) reports */}
      <h2 className="text-sm font-semibold text-slate-700 mb-3">Saved reports</h2>
      {reports.length === 0 ? (
        <div className="card mb-8 text-center py-10">
          <Table2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <div className="text-slate-500 font-medium mb-1">No saved reports yet</div>
          <p className="text-sm text-slate-400 mb-5 max-w-sm mx-auto">Build a report over Service Requests, Deals or Contacts — pick columns, filters and grouping, then save it.</p>
          <Link href="/reports/new" className="px-4 py-2 text-sm font-semibold rounded-lg text-white inline-flex items-center gap-1.5" style={{ background: accent }}>
            <Plus className="w-4 h-4" /> Build your first report
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {reports.map((r) => (
            <Link key={r.id} href={`/reports/${r.id}`} className="card group transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: accent + "12" }}>
                  <Table2 className="w-5 h-5" style={{ color: accent }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <h3 className="font-semibold text-slate-800 truncate">{r.name}</h3>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors ml-auto shrink-0" />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">{r.description || SOURCE_LABELS[r.source] || r.source}</p>
                  <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1">{r.shared ? <><Users className="w-3 h-3" /> Shared</> : <><Lock className="w-3 h-3" /> Private</>}</span>
                    <span>·</span>
                    <span>{SOURCE_LABELS[r.source] ?? r.source}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* System reports */}
      <h2 className="text-sm font-semibold text-slate-700 mb-3">System reports</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {systemCards.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.href} href={c.href} className="card group transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: accent + "12" }}>
                  <Icon className="w-5 h-5" style={{ color: accent }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <h3 className="font-semibold text-slate-800">{c.label}</h3>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors ml-auto" />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{c.description}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
