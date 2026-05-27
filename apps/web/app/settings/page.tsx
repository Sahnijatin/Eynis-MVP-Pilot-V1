import { fetchConnectorRegistry } from "../../lib/data";
import { Save, UserPlus, Camera, Clock, Phone } from "lucide-react";
import { ConnectorConfigPanel } from "../../components/ui/connector-config-panel";
import { ChangeIndustry } from "../../components/ui/change-industry";
import { getUserWorkspace } from "../../lib/workspace";

export const dynamic = "force-dynamic";

const tabs = ["Profile", "Property", "Users", "Integrations"];

const connectorCategoryLabel: Record<string, string> = {
  communication: "Communication",
  pms: "Property Management",
  pos: "Point of Sale",
  payments: "Payments"
};

export default async function SettingsPage() {
  let connectors: Awaited<ReturnType<typeof fetchConnectorRegistry>> | null = null;
  let error = "";
  try {
    connectors = await fetchConnectorRegistry();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load connectors";
  }

  const { industry } = await getUserWorkspace();

  const connectorItems = connectors?.items ?? [];

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">Manage your profile, property details, team access, and external integrations.</p>
          </div>
          <button className="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-1.5" style={{ background: "#0f766e" }}>
            <Save className="w-3.5 h-3.5" /> Save Changes
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6">
        {tabs.map((tab, i) => (
          <button key={tab} className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${i === 0 ? "border-teal-700 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Main settings */}
        <div className="col-span-2 space-y-4">
          {/* Industry workspace switcher */}
          <div className="card">
            <h3 className="text-base font-semibold text-slate-800 mb-1">Industry Workspace</h3>
            <p className="text-sm text-slate-400 mb-4">Switch your workspace to a different industry. Nav, modules, and terminology will update instantly.</p>
            <ChangeIndustry currentIndustry={industry ?? "hospitality"} />
          </div>

          {/* Account Information */}
          <div className="card">
            <h3 className="text-base font-semibold text-slate-800 mb-1">Account Information</h3>
            <p className="text-sm text-slate-400 mb-4">Update your photo and personal details.</p>

            <div className="flex items-center gap-4 mb-5">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-teal-700 flex items-center justify-center text-white text-xl font-bold">VM</div>
                <button className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white shadow border border-slate-200 flex items-center justify-center">
                  <Camera className="w-3 h-3 text-slate-500" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Full Name</label>
                <input defaultValue="Marcus Vane" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email Address</label>
                <input defaultValue="vikram@theriviera.com" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">New Password</label>
              <input type="password" defaultValue="••••••••••" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>

          {/* Property Details */}
          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold text-slate-800">The Riviera Details</h3>
              <span className="badge badge-amber text-[10px]">GLOBAL MASTER</span>
            </div>
            <p className="text-sm text-slate-400 mb-4">Property configuration for all staff and integrations.</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Address</label>
                <input defaultValue="72 Promenade des Anglais, Nice, France" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Room Count</label>
                <input defaultValue="142" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Contact Phone</label>
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-slate-400" />
                  <input defaultValue="+91 98765 40001" className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Check-in Time</label>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <input defaultValue="03:00 PM" className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Check-out Time</label>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <input defaultValue="11:00 AM" className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Team Access */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-800">Team Access</h3>
                <p className="text-sm text-slate-400">Manage permissions and invitation status for your hotel staff.</p>
              </div>
              <button className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5" /> Invite Member
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Vikram Mehta", email: "vikram@theriviera.com", role: "Owner", active: true },
                    { name: "Sarah Jenkins", email: "sarah@theriviera.com", role: "Front Desk", active: true },
                    { name: "Amit Sharma", email: "amit@theriviera.com", role: "Housekeeping", active: true },
                    { name: "David Ling", email: "david@theriviera.com", role: "F&B Manager", active: true }
                  ].map((u) => (
                    <tr key={u.email}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-full bg-teal-700 flex items-center justify-center text-white text-[10px] font-semibold">
                            {u.name.split(" ").map(w => w[0]).join("")}
                          </span>
                          <div>
                            <div className="text-sm font-medium">{u.name}</div>
                            <div className="text-xs text-slate-400">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="badge badge-slate">{u.role}</span></td>
                      <td><span className="badge badge-green">Active</span></td>
                      <td><button className="text-sm text-slate-400 hover:text-red-500">Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Integrations */}
          <div className="card">
            <h3 className="text-base font-semibold text-slate-800 mb-1">Integrations</h3>
            <p className="text-sm text-slate-400 mb-4">Manage connected systems and API keys.</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Connector</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Modes</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {connectorItems.map((c) => (
                    <tr key={c.key}>
                      <td className="font-medium text-slate-800 text-sm">{c.key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}</td>
                      <td className="text-slate-500 text-sm">{connectorCategoryLabel[c.category] ?? c.category}</td>
                      <td>
                        <span className={`badge ${c.enabled ? "badge-green" : c.status === "planned" ? "badge-slate" : "badge-amber"}`}>
                          {c.enabled ? "Connected" : c.status === "planned" ? "Planned" : "Disabled"}
                        </span>
                      </td>
                      <td className="text-xs text-slate-400">{c.ingestModes.join(", ")}</td>
                      <td><ConnectorConfigPanel connectorKey={c.key} enabled={c.enabled} /></td>
                    </tr>
                  ))}
                  {connectorItems.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-8 text-slate-400">No connectors available</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Notifications */}
          <div className="card">
            <h3 className="card-title">Notifications</h3>
            <div className="space-y-3">
              {[
                { label: "New Booking Alerts", on: true },
                { label: "Revenue Reports (Daily)", on: true },
                { label: "Security Logs", on: false }
              ].map((n) => (
                <div key={n.label} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">{n.label}</span>
                  <button className={`w-10 h-5 rounded-full transition-colors flex items-center ${n.on ? "justify-end" : "justify-start"}`} style={{ background: n.on ? "#0f766e" : "#e2e8f0", padding: "2px" }}>
                    <span className="w-4 h-4 rounded-full bg-white shadow-sm block" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Property Location */}
          <div className="card overflow-hidden p-0">
            <div className="h-36 bg-slate-200 flex items-end" style={{ background: "linear-gradient(135deg, #1a365d 0%, #2b6cb0 50%, #63b3ed 100%)" }}>
              <div className="p-3 text-white">
                <div className="text-xs font-semibold uppercase tracking-wider opacity-70">Property Location</div>
                <div className="text-sm font-bold">Promenade des Anglais, Nice</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
