import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { NavModule } from "../../lib/industry-config";

// Generic module landing/overview screen (E-2). Renders a module header and a card
// per sub-feature, each linking to the underlying page. Driven entirely by the
// industry config so every vertical inherits the same 7-module skeleton.
export function ModuleLanding({ module, accentColor }: { module: NavModule; accentColor: string }) {
  const Icon = module.icon;
  const items = module.children ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-1.5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: accentColor + "18" }}>
          <Icon className="w-5 h-5" style={{ color: accentColor }} />
        </div>
        <h1 className="text-xl font-semibold text-slate-800">{module.label}</h1>
      </div>
      {module.description && (
        <p className="text-sm text-slate-500 mb-5 max-w-2xl">{module.description}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((c) => {
          const CIcon = c.icon;
          return (
            <Link key={c.href} href={c.href} className="card group transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: accentColor + "12" }}>
                  <CIcon className="w-5 h-5" style={{ color: accentColor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <h3 className="font-semibold text-slate-800">{c.label}</h3>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors ml-auto" />
                  </div>
                  {c.description && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{c.description}</p>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
