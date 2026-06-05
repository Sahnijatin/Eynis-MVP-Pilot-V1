import Link from "next/link";
import { FileText, Moon, BarChart3, ChevronRight } from "lucide-react";
import { getUserWorkspace } from "../../lib/workspace";

export const dynamic = "force-dynamic";

// Reports lives under the Analytics module (E-2). The full report builder is owned
// by E-16; for now this surfaces the report types that already exist per industry
// (e.g. hospitality's AI Night Audit) and links to Analytics for the rest.
export default async function ReportsPage() {
  const { config, industry } = await getUserWorkspace();
  const accent = config.accentColor;

  const cards: Array<{ icon: typeof FileText; label: string; description: string; href: string }> = [];
  if (industry === "hospitality") {
    cards.push({ icon: Moon, label: "Night Audit", description: "AI-generated end-of-day operations report.", href: "/night-audit" });
  }
  cards.push({ icon: BarChart3, label: "Revenue & Trends", description: "Performance analytics and trends.", href: "/analytics" });

  return (
    <div>
      <div className="flex items-center gap-3 mb-1.5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: accent + "18" }}>
          <FileText className="w-5 h-5" style={{ color: accent }} />
        </div>
        <h1 className="text-xl font-semibold text-slate-800">Reports</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5 max-w-2xl">
        Generated operational reports and exports. More report types — including a custom report
        builder — are on the way.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => {
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
