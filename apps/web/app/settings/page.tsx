import { Lock, MapPin, ExternalLink } from "lucide-react";
import { BrandingPanel } from "../../components/ui/branding-panel";
import { DomainsPanel } from "../../components/ui/domains-panel";
import { SettingsProfileForm } from "../../components/ui/settings-profile-form";
import { NotificationPrefsCard } from "../../components/ui/notification-prefs-card";
import { Badge } from "../../components/ds";
import { getUserWorkspace } from "../../lib/workspace";
import { resolveUserContext } from "../../lib/user-context";
import { fetchTenantProfile } from "../../lib/data";

export const dynamic = "force-dynamic";

// Brand accent — the tenant's resolved white-label color (published on :root by
// the app shell), falling back to teal for SSR. Use this, never a bare hex or the
// industry default, so primary surfaces follow the tenant brand (design-system doc).
const BRAND = "var(--color-primary, #0f766e)";

function buildTabs(propertyLabel: string, teamLabel: string) {
  return [
    { label: `Profile & ${propertyLabel}`, href: "/settings" },
    { label: teamLabel, href: "/settings/team" },
    { label: "Roles", href: "/settings/roles" },
    { label: "Billing", href: "/settings/billing" },
  ];
}

// Flagship reference migration (E-13b): the Settings page now uses the ds/ design
// primitives (Button, Field, Input, Badge) and the brand CSS var for accents,
// instead of one-off `<input>`/`<button>` markup and hardcoded teal. Containers
// keep the established `.card` / `.page-header` classes (accepted vocabulary).
export default async function SettingsPage() {
  const { config } = await getUserWorkspace();
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

  // Editable property details (admins only). Non-admins get null → read-only name.
  const profile = isAdmin ? await fetchTenantProfile() : null;
  if (profile?.name) propertyName = profile.name;

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">Manage your profile, property details, team access, and external integrations.</p>
          </div>
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
                ? { borderColor: BRAND, color: BRAND }
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
            <p className="text-sm text-slate-500 mb-3">Your nav, modules, and terminology are tailored to your industry.</p>
            <div className="flex items-center gap-3">
              <Badge tone="accent">{config.name}</Badge>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Lock className="w-3 h-3" /> Managed for you — contact support to change your industry.
              </span>
            </div>
          </div>

          {/* White-label branding — admins only */}
          {isAdmin && <BrandingPanel />}

          {/* White-label domains — admins only. The platform base domain comes
              from the deployment env so resellers show their own. */}
          {isAdmin && <DomainsPanel />}

          {/* Account + Property details — client form with a working Save. */}
          <SettingsProfileForm
            initialFullName={fullName ?? ""}
            email={email ?? ""}
            initialPropertyName={propertyName}
            canEditProperty={isAdmin}
            propertyLabel={propertyLabel}
            initialTimezone={profile?.timezone ?? ""}
            initialAddress={profile?.address ?? ""}
            initialPhone={profile?.phone ?? ""}
          />

          {/* Quick links to sub-pages */}
          <div className="grid grid-cols-3 gap-3">
            <a href="/settings/team" className="card hover:border-teal-200 hover:bg-teal-50/30 transition-colors cursor-pointer border border-transparent">
              <div className="text-sm font-semibold text-slate-800 mb-1">Team Members</div>
              <p className="text-xs text-slate-500">Invite staff, assign roles, manage access.</p>
              <span className="text-xs font-medium mt-2 block" style={{ color: BRAND }}>Manage team →</span>
            </a>
            <a href="/settings/roles" className="card hover:border-teal-200 hover:bg-teal-50/30 transition-colors cursor-pointer border border-transparent">
              <div className="text-sm font-semibold text-slate-800 mb-1">Roles & Permissions</div>
              <p className="text-xs text-slate-500">Rename roles, view permissions, create custom roles.</p>
              <span className="text-xs font-medium mt-2 block" style={{ color: BRAND }}>Manage roles →</span>
            </a>
            <a href="/settings/billing" className="card hover:border-teal-200 hover:bg-teal-50/30 transition-colors cursor-pointer border border-transparent">
              <div className="text-sm font-semibold text-slate-800 mb-1">License & Billing</div>
              <p className="text-xs text-slate-500">Seat usage, plan details, and Razorpay billing.</p>
              <span className="text-xs font-medium mt-2 block" style={{ color: BRAND }}>Manage billing →</span>
            </a>
          </div>

          {/* Integrations moved to their own module (E-5) */}
          <a href="/integrations" className="card block hover:bg-slate-50 transition-colors">
            <h3 className="text-base font-semibold text-slate-800 mb-1">Integrations</h3>
            <p className="text-sm text-slate-500">WhatsApp, PMS/POS, payments, voice and email connectors now live in their own Integrations module.</p>
            <span className="text-xs font-medium mt-2 block" style={{ color: BRAND }}>Open Integrations →</span>
          </a>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Notifications — real per-user preferences, saved on toggle. */}
          <NotificationPrefsCard />

          {/* Property Location — the real address (when set), with a maps link,
              instead of a decorative gradient. */}
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4" style={{ color: BRAND }} />
              <h3 className="card-title mb-0">{propertyLabel} Location</h3>
            </div>
            <div className="text-sm font-semibold text-slate-800">{propertyName}</div>
            {profile?.address ? (
              <>
                <div className="text-sm text-slate-500 mt-0.5">{profile.address}</div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.address)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium mt-2" style={{ color: BRAND }}
                >
                  View on map <ExternalLink className="w-3 h-3" />
                </a>
              </>
            ) : (
              <div className="text-xs text-slate-400 mt-1">
                {isAdmin ? "Add an address above to show it here with a map link." : "No address on file."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
