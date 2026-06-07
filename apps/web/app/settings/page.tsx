import { Save, Camera, Clock, Phone, Lock } from "lucide-react";
import { BrandingPanel } from "../../components/ui/branding-panel";
import { DomainsPanel } from "../../components/ui/domains-panel";
import { getUserWorkspace } from "../../lib/workspace";
import { resolveUserContext } from "../../lib/user-context";

export const dynamic = "force-dynamic";

function buildTabs(propertyLabel: string, teamLabel: string) {
  return [
    { label: `Profile & ${propertyLabel}`, href: "/settings" },
    { label: teamLabel, href: "/settings/team" },
    { label: "Roles", href: "/settings/roles" },
    { label: "Billing", href: "/settings/billing" },
  ];
}

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default async function SettingsPage() {
  const { config } = await getUserWorkspace();
  const accent = config.accentColor;
  const tabs = buildTabs(config.terminology.property, config.terminology.team);
  const propertyLabel = config.terminology.property;

  // Drive profile + property sections from the current tenant/user, not the
  // hardcoded Riviera demo data (E-11 / white-label by default).
  let isAdmin = true;
  let fullName: string | null = null;
  let email: string | null = null;
  // The tenant's property name; falls back to the industry term ("Hotel"/"Plant"/…).
  let propertyName = propertyLabel;
  try {
    const ctx = await resolveUserContext();
    // Only the workspace admin sees the white-label panels. Industry is no longer
    // self-service for anyone — it is provisioned by Eynis staff (E-8).
    isAdmin = ctx.orgRole === "org_admin";
    fullName = ctx.fullName;
    email = ctx.email;
    if (ctx.propertyName) propertyName = ctx.propertyName;
  } catch {}

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">Manage your profile, property details, team access, and external integrations.</p>
          </div>
          <button className="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-1.5" style={{ background: accent }}>
            <Save className="w-3.5 h-3.5" /> Save Changes
          </button>
        </div>
      </div>


      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6">
        {tabs.map((tab) => {
          const active = tab.href === "/settings";
          return (
            <a
              key={tab.href}
              href={tab.href}
              className="px-5 py-3 text-sm font-medium border-b-2 transition-colors"
              style={active
                ? { borderColor: accent, color: accent }
                : { borderColor: "transparent", color: "#64748b" }
              }
            >
              {tab.label}
            </a>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Main settings */}
        <div className="col-span-2 space-y-4">
          {/* Industry workspace — read-only (E-8). Industry is provisioned by us at
              onboarding and re-shapes nav/terminology/features, so it is not a
              self-service setting. Customers see it, but can't change it. */}
          <div className="card">
            <h3 className="text-base font-semibold text-slate-800 mb-1">Industry Workspace</h3>
            <p className="text-sm text-slate-400 mb-3">Your nav, modules, and terminology are tailored to your industry.</p>
            <div className="flex items-center gap-3">
              <span
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold"
                style={{ background: accent + "12", color: accent }}
              >
                {config.name}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <Lock className="w-3 h-3" /> Managed for you — contact support to change your industry.
              </span>
            </div>
          </div>

          {/* White-label branding — admins only */}
          {isAdmin && <BrandingPanel />}

          {/* White-label domains — admins only */}
          {isAdmin && <DomainsPanel />}

          {/* Account Information */}
          <div className="card">
            <h3 className="text-base font-semibold text-slate-800 mb-1">Account Information</h3>
            <p className="text-sm text-slate-400 mb-4">Update your photo and personal details.</p>

            <div className="flex items-center gap-4 mb-5">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-teal-700 flex items-center justify-center text-white text-xl font-bold">{initials(fullName)}</div>
                <button className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white shadow border border-slate-200 flex items-center justify-center">
                  <Camera className="w-3 h-3 text-slate-500" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Full Name</label>
                <input defaultValue={fullName ?? ""} placeholder="Your full name" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email Address</label>
                <input defaultValue={email ?? ""} placeholder="you@example.com" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
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
              <h3 className="text-base font-semibold text-slate-800">{propertyName} Details</h3>
              <span className="badge badge-amber text-[10px]">GLOBAL MASTER</span>
            </div>
            <p className="text-sm text-slate-400 mb-4">{propertyLabel} configuration for all staff and integrations.</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Address</label>
                <input defaultValue="" placeholder="Street, city, country" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{propertyLabel} Phone</label>
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-slate-400" />
                  <input defaultValue="" placeholder="Contact number" className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Timezone</label>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <input defaultValue="" placeholder="e.g. Asia/Kolkata" className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Quick links to sub-pages */}
          <div className="grid grid-cols-3 gap-3">
            <a href="/settings/team" className="card hover:border-teal-200 hover:bg-teal-50/30 transition-colors cursor-pointer border border-transparent">
              <div className="text-sm font-semibold text-slate-800 mb-1">Team Members</div>
              <p className="text-xs text-slate-400">Invite staff, assign roles, manage access.</p>
              <span className="text-xs text-teal-700 font-medium mt-2 block">Manage team →</span>
            </a>
            <a href="/settings/roles" className="card hover:border-teal-200 hover:bg-teal-50/30 transition-colors cursor-pointer border border-transparent">
              <div className="text-sm font-semibold text-slate-800 mb-1">Roles & Permissions</div>
              <p className="text-xs text-slate-400">Rename roles, view permissions, create custom roles.</p>
              <span className="text-xs text-teal-700 font-medium mt-2 block">Manage roles →</span>
            </a>
            <a href="/settings/billing" className="card hover:border-teal-200 hover:bg-teal-50/30 transition-colors cursor-pointer border border-transparent">
              <div className="text-sm font-semibold text-slate-800 mb-1">License & Billing</div>
              <p className="text-xs text-slate-400">Seat usage, plan details, and Razorpay billing.</p>
              <span className="text-xs text-teal-700 font-medium mt-2 block">Manage billing →</span>
            </a>
          </div>

          {/* Integrations moved to their own module (E-5) */}
          <a href="/integrations" className="card block hover:bg-slate-50 transition-colors">
            <h3 className="text-base font-semibold text-slate-800 mb-1">Integrations</h3>
            <p className="text-sm text-slate-400">WhatsApp, PMS/POS, payments, voice and email connectors now live in their own Integrations module.</p>
            <span className="text-xs text-teal-700 font-medium mt-2 block">Open Integrations →</span>
          </a>
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
                <div className="text-xs font-semibold uppercase tracking-wider opacity-70">{propertyLabel} Location</div>
                <div className="text-sm font-bold">{propertyName}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
