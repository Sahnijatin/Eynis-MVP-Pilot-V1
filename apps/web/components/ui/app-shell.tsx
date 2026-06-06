"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { Bell, Building2, CalendarDays, X, ShieldAlert, ChevronDown, UserCog, ShieldOff } from "lucide-react";
import { useUser, UserButton } from "@clerk/nextjs";
import { getIndustryConfig, type Industry, type NavModule } from "../../lib/industry-config";
import { resolveTheme, type TenantBranding } from "../../lib/theme";
import {
  type OrgRole,
  ORG_ROLE_LABELS,
  SYSTEM_ROLES,
  canAccessRoute,
  getAllowedModules,
} from "../../lib/rbac";
import { ImpersonationModal } from "./impersonation-modal";

// Shape of who's behind the session while impersonating (E-6).
interface Impersonating {
  impersonatorEmail: string;
  impersonatorName: string | null;
  targetEmail: string;
  targetName: string | null;
}

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

// Vertical pages that still render demonstration data and don't persist through
// the API yet (F-19). The `inventory` vertical is fully wired and is the template
// the rest follow; until each is built on it, we label them honestly as "Preview"
// so demos don't overpromise.
const PREVIEW_ROUTES = [
  "/materials", "/menu", "/orders", "/patients", "/appointments",
  "/bookings", "/quotes", "/customers", "/ai-brain",
];

function isPreviewRoute(pathname: string): boolean {
  return PREVIEW_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

// ── Sidebar module tree (E-2) ──────────────────────────────────────────────────

function routeMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// A module is "active" when its own landing route or any of its sub-items is the
// current page. /dashboard only matches exactly so it doesn't light up everywhere.
function isModuleActive(m: NavModule, pathname: string): boolean {
  const selfMatch = m.href === "/dashboard" ? pathname === "/dashboard" : routeMatches(pathname, m.href);
  if (selfMatch) return true;
  return (m.children ?? []).some((c) => routeMatches(pathname, c.href));
}

function SidebarNav({ modules, pathname, accentColor }: { modules: NavModule[]; pathname: string; accentColor: string }) {
  // Manually-toggled modules override the default (which auto-expands the module
  // containing the active route). Keyed by module key.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const activeStyle = { background: accentColor + "22", color: "#fff", borderLeft: `3px solid ${accentColor}` };

  return (
    <nav className="sidebar-nav">
      {modules.map((m) => {
        const Icon = m.icon;
        const children = m.children ?? [];
        const moduleActive = isModuleActive(m, pathname);

        if (children.length === 0) {
          return (
            <Link
              key={m.key}
              href={m.href}
              className={`nav-link${moduleActive ? " active" : ""}`}
              style={moduleActive ? activeStyle : undefined}
            >
              <Icon className="nav-icon" />
              {m.label}
            </Link>
          );
        }

        const open = m.key in overrides ? overrides[m.key] : moduleActive;
        return (
          <div key={m.key}>
            <div className={`nav-link nav-module${moduleActive ? " active" : ""}`} style={moduleActive ? activeStyle : undefined}>
              <Link href={m.href} className="flex items-center gap-3 flex-1 min-w-0">
                <Icon className="nav-icon" />
                {m.label}
              </Link>
              <button
                type="button"
                className="nav-module-toggle"
                aria-label={`${open ? "Collapse" : "Expand"} ${m.label}`}
                aria-expanded={open}
                onClick={() => setOverrides((s) => ({ ...s, [m.key]: !open }))}
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
            </div>
            {open && (
              <div className="sidebar-subnav">
                {children.map((c) => {
                  const CIcon = c.icon;
                  const childActive = routeMatches(pathname, c.href);
                  return (
                    <Link key={c.href} href={c.href} className={`nav-sublink${childActive ? " active" : ""}`}>
                      <CIcon className="nav-subicon" />
                      {c.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
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
  // `orgRole` is the effective role the app renders for — the signed-in user's
  // role, or (while impersonating, E-6) the target user's role. It is resolved
  // server-side from the impersonation cookie; the client never decides it.
  const [orgRole, setOrgRoleState] = useState<OrgRole>(initialOrgRole);
  const [industry, setIndustryState] = useState<Industry>(initialIndustry);
  const [propertyName, setPropertyNameState] = useState<string>(initialPropertyName ?? "Eynis");
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  const [impersonating, setImpersonating] = useState<Impersonating | null>(null);
  const [impModalOpen, setImpModalOpen] = useState(false);
  const [stoppingImp, setStoppingImp] = useState(false);

  // ── Fetch fresh context from server when user is loaded ──────────────────
  // The root layout may have rendered before sign-in (returning defaults),
  // so we re-fetch here once Clerk confirms the user is authenticated. This
  // also surfaces any active impersonation (resolved server-side from the cookie).
  useEffect(() => {
    if (!isLoaded || !user) return;
    fetch("/api/me", { cache: "no-store" })
      .then(r => r.json())
      .then((data: { ok: boolean; exists?: boolean; orgRole?: OrgRole; industry?: Industry; propertyName?: string | null; branding?: TenantBranding | null; impersonating?: Impersonating | null }) => {
        if (data.ok && data.exists) {
          setBranding(data.branding ?? null);
          if (data.orgRole) setOrgRoleState(data.orgRole);
          if (data.industry) setIndustryState(data.industry);
          if (data.propertyName) setPropertyNameState(data.propertyName);
          setImpersonating(data.impersonating ?? null);
        }
      })
      .catch(() => { /* fail silently — keep initial defaults */ });
  }, [isLoaded, user]);

  async function stopImpersonation() {
    setStoppingImp(true);
    try {
      await fetch("/api/impersonate", { method: "DELETE" });
    } catch { /* cookie clear is best-effort; reload re-resolves identity */ }
    window.location.assign("/dashboard");
  }

  // ── Industry / config ────────────────────────────────────────────────────
  const config = getIndustryConfig(industry);
  const visibleModules = getAllowedModules(config.modules, orgRole);

  // ── Resolved white-label theme (tenant ▶ industry ▶ Eynis) ─────────────────
  const theme = resolveTheme(branding, config);

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
  // Drive the global theme CSS variables off the resolved tenant theme so the
  // whole UI (incl. the design-system tokens) picks up white-label colors.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--color-industry", theme.primaryColor);
    root.setProperty("--color-primary", theme.primaryColor);
    root.setProperty("--color-accent", theme.accentColor);
  }, [theme.primaryColor, theme.accentColor]);

  // White-label the browser tab: favicon (falls back to the logo) + brand title.
  useEffect(() => {
    if (theme.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = theme.faviconUrl;
    }
    const brand = theme.brandName ?? propertyName;
    if (brand) document.title = brand;
  }, [theme.faviconUrl, theme.brandName, propertyName]);

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
            <div className="brand-logo-icon" style={{ background: theme.logoUrl ? "transparent" : theme.primaryColor, overflow: "hidden" }}>
              {theme.logoUrl
                ? <img src={theme.logoUrl} alt="" className="w-full h-full object-contain" />
                : <OverviewIcon className="w-4 h-4 text-white" />}
            </div>
            <div className="flex flex-col leading-tight">
              {(theme.brandName || !theme.hidePoweredBy) && (
                <span className="text-[10px] uppercase tracking-widest font-medium" style={{ color: "#5a7a9a" }}>
                  {theme.brandName ?? "Eynis"}
                </span>
              )}
              <span className="brand-title" title={propertyName} style={{ fontSize: "15px" }}>
                {propertyName}
              </span>
            </div>
          </div>
          <div className="brand-subtitle">{theme.subtitle}</div>
        </div>

        <div className="sidebar-industry-badge" style={{ borderColor: theme.primaryColor + "33", background: theme.primaryColor + "11" }}>
          <OverviewIcon className="w-3.5 h-3.5" style={{ color: theme.primaryColor }} />
          <span style={{ color: theme.primaryColor }}>{config.name}</span>
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

        <SidebarNav modules={visibleModules} pathname={pathname} accentColor={config.accentColor} />

        <div className="sidebar-footer">
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
              <UserButton>
                {impersonating ? (
                  <UserButton.MenuItems>
                    <UserButton.Action
                      label="Stop impersonating"
                      labelIcon={<ShieldOff className="w-4 h-4" />}
                      onClick={stopImpersonation}
                    />
                  </UserButton.MenuItems>
                ) : orgRole === "org_admin" ? (
                  <UserButton.MenuItems>
                    <UserButton.Action
                      label="Impersonate a user"
                      labelIcon={<UserCog className="w-4 h-4" />}
                      onClick={() => setImpModalOpen(true)}
                    />
                  </UserButton.MenuItems>
                ) : null}
              </UserButton>
            </div>
          </div>
        </header>

        {/* Impersonation banner (E-6) — persistent while viewing as another user */}
        {impersonating && (
          <div className="flex items-center gap-3 px-5 py-2.5 text-sm text-white" style={{ background: "#b45309" }}>
            <UserCog className="w-4 h-4 shrink-0" />
            <span>
              Viewing as <strong>{impersonating.targetName || impersonating.targetEmail}</strong>
              <span className="opacity-80"> ({ORG_ROLE_LABELS[orgRole]}) — actions are recorded under your account</span>
            </span>
            <button
              onClick={stopImpersonation}
              disabled={stoppingImp}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-white/20 hover:bg-white/30 disabled:opacity-60"
            >
              <ShieldOff className="w-3.5 h-3.5" />
              {stoppingImp ? "Stopping…" : "Stop impersonating"}
            </button>
          </div>
        )}

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

        {/* Honest "Preview" banner for vertical pages not yet backed by the API (F-19) */}
        {!isPublicRoute && isPreviewRoute(pathname) && (
          <div className="flex items-center gap-3 px-5 py-2.5 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <span>
              <strong>Preview</strong> — this page shows demonstration data and does not yet persist
              changes to your account. The Inventory module is the live template the rest are built on.
            </span>
          </div>
        )}

        <main className="content-shell">{children}</main>
      </div>

      {impModalOpen && (
        <ImpersonationModal accentColor={config.accentColor} onClose={() => setImpModalOpen(false)} />
      )}
    </div>
  );
}
