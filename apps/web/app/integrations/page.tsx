import Link from "next/link";
import { Plug, MessageSquare, Database, CreditCard, ChevronRight, Settings } from "lucide-react";
import { getUserWorkspace } from "../../lib/workspace";

export const dynamic = "force-dynamic";

// Integrations is promoted to its own top-level module (E-2). The dedicated
// connectors hub is owned by E-5; until it lands, connectors are configured in
// Settings, so each card links there honestly rather than implying a hub exists.
const CATEGORIES = [
  { icon: MessageSquare, label: "Messaging & Channels", description: "WhatsApp (Twilio / Interakt) and other inbound channels." },
  { icon: Database, label: "PMS / POS", description: "Property-management and point-of-sale systems." },
  { icon: CreditCard, label: "Payments", description: "Payment gateways and billing providers." }
];

export default async function IntegrationsPage() {
  const { config } = await getUserWorkspace();
  const accent = config.accentColor;

  return (
    <div>
      <div className="flex items-center gap-3 mb-1.5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: accent + "18" }}>
          <Plug className="w-5 h-5" style={{ color: accent }} />
        </div>
        <h1 className="text-xl font-semibold text-slate-800">Integrations</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5 max-w-2xl">
        Connect the tools that power your operation. Connectors are currently managed in Settings — a
        dedicated Integrations hub is on the way.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.label} href="/settings" className="card group transition-shadow hover:shadow-md">
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

      <Link href="/settings" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: accent }}>
        <Settings className="w-4 h-4" /> Manage all connectors in Settings <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
