"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { Bell, Building2, CalendarDays, X, ShieldCheck, ShieldAlert, Lock } from "lucide-react";
import { useUser, UserButton } from "@clerk/nextjs";
import { getIndustryConfig, type Industry } from "../../lib/industry-config";
import {
  type OrgRole,
  ORG_ROLE_LABELS,
  SYSTEM_ROLES,
  canAccessRoute,
  getAllowedNavItems,
} from "../../lib/rbac";

// ── Notifications ────────────────────────────────────────────────────────────

type Notif = { id: string; title: string; body: string; time: string; type: "alert" | "info" | "success" };

const NOTIFS: Record<string, Notif[]> = {
  manufacturing: [
    { id: "n1", title: "Burma Teak Planks — Out of Stock", body: "2 orders at risk · ETA: 4 Jun", time: "2 min ago", type: "alert" },
    { id: "n2", title: "New Enquiry — ITC Hotels", body: "Lobby Benches × 12 · Estimated ₹5.4L", time: "18 min ago", type: "info" },
    { id: "n3", title: "BOM Variance Detected", body: "ORD-2847 · Burma Teak +21% over BOM", time: "1 hr ago", type: "alert" },
    { id: "n4", title: "Quote Expiring Soon", body: "QT-0411 · Kapoor Developers · Expires 4 Jun", time: "2 hr ago", type: "info" },
  ],
  hospitality: [
    { id: "n1", title: "Service Overdue — Room 302", body: "Open 45+ mins · Auto-escalated to manager", time: "5 min ago", type: "alert" },
    { id: "n2", title: "PMS Sync Lag", body: "Inventory sync delayed by 4 minutes", time: "22 min ago", type: "alert" },
    { id: "n3", title: "Guest Check-in — VIP", body: "Ravi Sharma · Room 204 · Loyalty Platinum", time: "1 hr ago", type: "info" },
    { id: "n4", title: "Upsell Opportunity", body: "8 check-outs tomorrow · Run upgrade offer now", time: "2 hr ago", type: "info" },
  ],
  fnb: [
    { id: "n1", title: "Truffle Oil — Critical Stock", body: "Only 4 bottles left · Reorder level: 6", time: "5 min ago", type: "alert" },
    { id: "n2", title: "Cocktail of the Week Trending", body: "204 orders this month — consider expanding", time: "1 hr ago", type: "success" },
    { id: "n3", title: "Lamb Rack Margin Below Floor", body: "Margin at 49% · Review supplier pricing", time: "2 hr ago", type: "alert" },
  ],
  travel: [
    { id: "n1", title: "Action Needed — BKG-1046", body: "IT Company Offsite · 0% paid · Departs 7 Jun", time: "10 min ago", type: "alert" },
    { id: "n2", title: "Visa Still Pending", body: "BKG-1039 · Mehta Corp · Singapore departs 3 Jun", time: "30 min ago", type: "alert" },
    { id: "n3", title: "Departure in 14 Days", body: "BKG-1042 · Arora Family · Maldives 7N/8D", time: "2 hr ago", type: "info" },
  ],
  healthcare: [
    { id: "n1", title: "No-Show Follow-up Required", body: "Amit Kumar · Missed today's diabetes consultation", time: "30 min ago", type: "alert" },
    { id: "n2", title: "Overdue Patient", body: "Arun Kumar · Cardiac monitoring · 43 days overdue", time: "1 hr ago", type: "alert" },
    { id: "n3", title: "Appointment Reminders Sent", body: "3 patients reminded for tomorrow's slots", time: "2 hr ago", type: "success" },
  ],
};

// ── Clock ─────────────────────────────────────────────────────────────────────

function TopbarClock() {
  const [display, setDisplay] = useState<string | null>(null);
  useEffect(() => {
    function tick() {
      const now = new Date();
      setDisplay(
        now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
        " • " +
        now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      );
    }
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);
  if (!display) return null;
  return <span className="topbar-date">{display}</span>;
}

// ── Role Switcher (org_admin only) ────────────────────────────────────────────

interface RoleSwitcherProps {
  role: OrgRole;
  accentColor: string;
  onSwitch: (r: OrgRole) => void;
}

function RoleSwitcher({ role, accentColor, onSwitch }: RoleSwitcherProps) {
  const [unlockOpen, setUnlockOpen] = useState(false);
  const def = SYSTEM_ROLES.find(r => r.key === role)!;

  if (role === "org_admin") {
    return (
      <div className="px-3 mb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <ShieldCheck className="w-3 h-3" style={{ color: "#5a7a9a" }} />
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#5a7a9a" }}>
            Preview As Role
          </span>
        </div>
        <div className="flex flex-col gap-1">
          {SYSTEM_ROLES.map(r => (
            <button
              key={r.key}
              title={r.description}
              onClick={() => onSwitch(r.key)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all text-left"
              style={role === r.key
                ? { background: accentColor, color: "#fff" }
                : { background: "rgba(255,255,255,0.07)", color: "#9ab0c8" }
              }
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: role === r.key ? "#fff" : r.iconColor }}
              />
              {r.defaultDisplayName}
              {r.key === "org_admin" && (
                <span className="ml-auto text-[9px] px-1 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.15)" }}>
                  YOU
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="text-[9px] mt-2 text-center" style={{ color: "#3d5a78" }}>
          Admins can preview any role
        </p>
      </div>
    );
  }

  // Non-admin: locked, with exit-preview option
  return (
    <div className="px-3 mb-3">
      <div
        className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ background: def.iconBg, color: def.iconColor }}
        >
          {def.defaultDisplayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-slate-200">{def.defaultDisplayName}</div>
          <div className="text-[9px]" style={{ color: "#5a7a9a" }}>Assigned role</div>
        </div>
        <Lock className="w-3 h-3 shrink-0" style={{ color: "#4a6a8a" }} />
      </div>

      {unlockOpen ? (
        <div className="mt-2 p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <p className="text-[10px] text-slate-300 mb-2">Switch back to Admin view?</p>
          <div className="flex gap-1">
            <button
              onClick={() => { onSwitch("org_admin"); setUnlockOpen(false); }}
              className="flex-1 py-1 rounded text-[10px] font-semibold text-white"
              style={{ background: accentColor }}
            >
              Yes, switch
            </button>
            <button
              onClick={() => setUnlockOpen(false)}
              className="flex-1 py-1 rounded text-[10px] font-semibold"
              style={{ background: "rgba(255,255,255,0.07)", color: "#7a9bbf" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setUnlockOpen(true)}
          className="w-full mt-1.5 text-[9px] text-center hover:underline"
          style={{ color: "#4a6a8a" }}
        >
          Exit preview → switch to Admin
        </button>
      )}
    </div>
  );
}

// ── AppShell ──────────────────────────────────────────────────────────────────

interface AppShellProps {
  children: ReactNode;
  initialOrgRole?: OrgRole;
  initialIndustry?: Industry;
  initialPropertyName?: string | null;
}

export function AppShell({ children, initialOrgRole = "org_admin", initialIndustry = "hospitality", initialPropertyName = null }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const notifRef = useRef<HTMLDivElement>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [accessDenied, setAccessDenied] = useState(false);
  // `orgRole` is the *currently viewed* role (may be a preview); `realOrgRole`
  // is the user's actual assigned role. Only a real admin may preview/switch.
  const [orgRole, setOrgRoleState] = useState<OrgRole>(initialOrgRole);
  const [realOrgRole, setRealOrgRole] = useState<OrgRole>(initialOrgRole);
  const [industry, setIndustryState] = useState<Industry>(initialIndustry);
  const [propertyName, setPropertyNameState] = useState<string>(initialPropertyName ?? "Eynis");

  // ── Fetch fresh context from server when user is loaded ──────────────────
  // The root layout may have rendered before sign-in (returning defaults),
  // so we re-fetch here once Clerk confirms the user is authenticated.
  useEffect(() => {
    if (!isLoaded || !user) return;
    fetch("/api/me", { cache: "no-store" })
      .then(r => r.json())
      .then((data: { ok: boolean; exists?: boolean; orgRole?: OrgRole; industry?: Industry; propertyName?: string | null }) => {
        if (data.ok && data.exists) {
          if (data.orgRole) {
            setRealOrgRole(data.orgRole);
            if (data.orgRole === "org_admin") {
              // Admins may resume a persisted preview; otherwise show admin.
              const saved = localStorage.getItem("eynis_org_role") as OrgRole | null;
              setOrgRoleState(saved && SYSTEM_ROLES.some(r => r.key === saved) ? saved : data.orgRole);
            } else {
              // Real non-admins are always locked to their assigned role —
              // never honour a stale preview left in localStorage.
              localStorage.removeItem("eynis_org_role");
              setOrgRoleState(data.orgRole);
            }
          }
          if (data.industry) setIndustryState(data.industry);
          if (data.propertyName) setPropertyNameState(data.propertyName);
        }
      })
      .catch(() => { /* fail silently — keep initial defaults */ });
  }, [isLoaded, user]);

  // ── Load persisted preview-role (admin-only) ─────────────────────────────
  // Non-admins stay locked to their assigned role; localStorage is ignored.
  useEffect(() => {
    if (realOrgRole !== "org_admin") return;
    const saved = localStorage.getItem("eynis_org_role") as OrgRole | null;
    if (saved && SYSTEM_ROLES.some(r => r.key === saved)) {
      setOrgRoleState(saved);
    }
  }, [realOrgRole]);

  function setOrgRole(r: OrgRole) {
    // Only real admins can switch role (preview-as feature). We gate on the
    // *real* role, not the currently-viewed one — otherwise an admin who has
    // previewed a lower role would be unable to exit the preview.
    if (realOrgRole !== "org_admin") return;
    setOrgRoleState(r);
    localStorage.setItem("eynis_org_role", r);
    if (!canAccessRoute(r, pathname)) {
      router.replace("/dashboard");
    }
  }

  // ── Industry / config ────────────────────────────────────────────────────
  const config = getIndustryConfig(industry);
  const visibleNavItems = getAllowedNavItems(config.navItems, orgRole);

  // ── Route guard ──────────────────────────────────────────────────────────
  const isPublicRoute =
    pathname.startsWith("/request") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/onboarding");

  useEffect(() => {
    if (isPublicRoute) return;
    if (!canAccessRoute(orgRole, pathname)) {
      setAccessDenied(true);
      router.replace("/dashboard");
      const t = setTimeout(() => setAccessDenied(false), 4500);
      return () => clearTimeout(t);
    }
  }, [pathname, orgRole, isPublicRoute, router]);

  // ── Misc effects ─────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.style.setProperty("--color-industry", config.accentColor);
  }, [config.accentColor]);

  useEffect(() => {
    if (!notifOpen) return;
    function handle(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [notifOpen]);

  if (isPublicRoute) {
    return <div className="public-shell">{children}</div>;
  }

  const notifs: Notif[] = NOTIFS[industry] ?? NOTIFS.hospitality;
  const unreadCount = notifs.filter(n => !readIds.has(n.id)).length;
  const OverviewIcon = config.overviewIcon;
  const roleDef = SYSTEM_ROLES.find(r => r.key === orgRole)!;

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="app-sidebar">
        <div className="brand-block">
          <div className="brand-logo">
            <div className="brand-logo-icon" style={{ background: config.accentColor }}>
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-widest font-medium" style={{ color: "#5a7a9a" }}>
                Eynis
              </span>
              <span className="brand-title" title={propertyName} style={{ fontSize: "15px" }}>
                {propertyName}
              </span>
            </div>
          </div>
          <div className="brand-subtitle">{config.tagline}</div>
        </div>

        <div className="sidebar-industry-badge" style={{ borderColor: config.accentColor + "33", background: config.accentColor + "11" }}>
          <OverviewIcon className="w-3.5 h-3.5" style={{ color: config.accentColor }} />
          <span style={{ color: config.accentColor }}>{config.name}</span>
        </div>

        {/* Current role chip */}
        <div className="px-3 mb-1">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            style={{ background: roleDef.iconBg + "22", border: `1px solid ${roleDef.iconColor}33` }}
          >
            <div
              className="w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold shrink-0"
              style={{ background: roleDef.iconBg, color: roleDef.iconColor }}
            >
              {roleDef.defaultDisplayName.slice(0, 2).toUpperCase()}
            </div>
            <span className="text-[11px] font-semibold" style={{ color: "#c8d8f0" }}>
              {ORG_ROLE_LABELS[orgRole]}
            </span>
            <span className="text-[9px] ml-auto" style={{ color: "#5a7899" }}>access</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {visibleNavItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`nav-link${active ? " active" : ""}`}
                style={active ? { background: config.accentColor + "22", color: "#fff", borderLeft: `3px solid ${config.accentColor}` } : {}}
              >
                <Icon className="nav-icon" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <RoleSwitcher role={orgRole} accentColor={config.accentColor} onSwitch={setOrgRole} />

          <div className="multi-property-badge">
            <Building2 className="w-3.5 h-3.5" />
            <span>Multi-{config.terminology.property}</span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.1)", color: "#7a9bbf" }}>
              PHASE 3
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-property">
            <span className="topbar-dot" style={{ background: config.accentColor }} />
            <span className="topbar-name">{config.name} Dashboard</span>
            <span className="text-slate-300 text-sm">|</span>
            <CalendarDays className="w-4 h-4 text-slate-400" />
            <TopbarClock />
          </div>
          <div className="topbar-right">
            <div className="relative" ref={notifRef}>
              <button className="topbar-icon-btn" onClick={() => setNotifOpen(v => !v)}>
                <Bell className="w-4.5 h-4.5" />
                {unreadCount > 0 && <span className="topbar-badge">{unreadCount}</span>}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-11 w-80 bg-white rounded-xl shadow-2xl border border-slate-100 z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800 text-sm">Notifications</span>
                      {unreadCount > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium text-white" style={{ background: config.accentColor }}>
                          {unreadCount} new
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setReadIds(new Set(notifs.map(n => n.id)))}>
                        Mark all read
                      </button>
                      <button onClick={() => setNotifOpen(false)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
                    {notifs.map(n => {
                      const unread = !readIds.has(n.id);
                      return (
                        <div
                          key={n.id}
                          onClick={() => setReadIds(prev => new Set([...prev, n.id]))}
                          className={`px-4 py-3 cursor-pointer transition-colors hover:bg-slate-50 ${unread ? "bg-blue-50/30" : ""}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.type === "alert" ? "bg-red-500" : n.type === "success" ? "bg-emerald-500" : "bg-blue-500"}`} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-slate-800">{n.title}</div>
                              <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{n.body}</div>
                              <div className="text-xs text-slate-400 mt-1">{n.time}</div>
                            </div>
                            {unread && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-2" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="px-4 py-2.5 border-t border-slate-100 text-center">
                    <button className="text-xs font-medium hover:underline" style={{ color: config.accentColor }}>
                      View all activity
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="topbar-user">
              <UserButton />
            </div>
          </div>
        </header>

        {/* Access denied banner */}
        {accessDenied && (
          <div className="flex items-center gap-3 px-5 py-3 text-sm text-red-800 bg-red-50 border-b border-red-100">
            <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />
            <span>
              Access restricted — <strong>{ORG_ROLE_LABELS[orgRole]}</strong> role cannot view that page.
              Redirected to Dashboard.
            </span>
            <button onClick={() => setAccessDenied(false)} className="ml-auto text-red-400 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <main className="content-shell">{children}</main>
      </div>
    </div>
  );
}
