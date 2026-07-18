"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { Bell, CalendarDays, X, ShieldAlert, ChevronDown, UserCog, ShieldOff, Menu } from "lucide-react";
import { useUser, UserButton } from "@clerk/nextjs";
import { getIndustryConfig, type Industry, type NavModule } from "../../lib/industry-config";
import { resolveTheme, type TenantBranding } from "../../lib/theme";
import { buildAccentRamp, accentRampToVars } from "../../lib/color/ramp";
import { ThemeToggle } from "./theme-toggle";
import type { ThemeMode } from "../../lib/theme-mode";
import {
  type OrgRole,
  ORG_ROLE_LABELS,
  SYSTEM_ROLES,
  canAccessRoute,
  getAllowedModules,
} from "../../lib/rbac";
import { ImpersonationModal } from "./impersonation-modal";
import { WorkspaceSwitcher } from "./workspace-switcher";
import type { WorkspaceSummary } from "../../lib/user-context";

// Shape of who's behind the session while impersonating (E-6).
interface Impersonating {
  impersonatorEmail: string;
  impersonatorName: string | null;
  targetEmail: string;
  targetName: string | null;
}

// ── Notifications ────────────────────────────────────────────────────────────
// Real, tenant-scoped operational alerts fetched from GET /api/notifications
// (SLA-breached / escalated requests, low-stock items, expiring quotes). `href`
// deep-links each item to the page where it can be acted on; `at` is an ISO
// timestamp rendered as relative time client-side.
type Notif = { id: string; type: "alert" | "info" | "success"; title: string; body: string; at: string; href: string };

// Render an ISO timestamp as a short relative string, handling both past
// (breaches) and future (expiring quotes) times.
function relativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const future = diffMs > 0;
  const mins = Math.round(Math.abs(diffMs) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return future ? `in ${mins} min` : `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return future ? `in ${hrs} hr` : `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return future ? `in ${days} day${days === 1 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"} ago`;
}

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
// (/patients left this list in Wave 5 — it is now backed by the real Patient model.)
const PREVIEW_ROUTES = [
  "/materials", "/menu", "/orders", "/appointments",
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
  // Platform/reseller brand shown to standard-tier tenants and on the shared
  // host, resolved from PLATFORM_BRAND_NAME server-side (never the hardcoded
  // literal "Eynis"). White-label tenants hide it entirely.
  platformBrand?: string;
  initialOrgRole?: OrgRole;
  initialIndustry?: Industry;
  initialPropertyName?: string | null;
  // Tenant branding resolved server-side in the root layout so the very first
  // paint already carries the tenant's brand — no flash of the Eynis fallback
  // before /api/me resolves (E-12).
  initialBranding?: TenantBranding | null;
  initialWhitelabelTier?: string | null;
}

export function AppShell({ children, platformBrand = "Eynis", initialOrgRole = "org_admin", initialIndustry = "hospitality", initialPropertyName = null, initialBranding = null, initialWhitelabelTier = null }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const notifRef = useRef<HTMLDivElement>(null);

  // Active light/dark theme (Phase 2). Initialised from the server-stamped
  // data-theme attribute and updated live when the toggle broadcasts a change,
  // so the accent ramp re-injects for the right theme.
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  useEffect(() => {
    const read = () => setThemeMode(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setThemeMode(detail === "dark" ? "dark" : "light");
    };
    window.addEventListener("eynis-theme-change", onChange);
    return () => window.removeEventListener("eynis-theme-change", onChange);
  }, []);

  const [navOpen, setNavOpen] = useState(false); // mobile sidebar drawer (E-13e)
  const [notifOpen, setNotifOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifLoaded, setNotifLoaded] = useState(false);
  const [notifError, setNotifError] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  // `orgRole` is the effective role the app renders for — the signed-in user's
  // role, or (while impersonating, E-6) the target user's role. It is resolved
  // server-side from the impersonation cookie; the client never decides it.
  const [orgRole, setOrgRoleState] = useState<OrgRole>(initialOrgRole);
  const [industry, setIndustryState] = useState<Industry>(initialIndustry);
  // Fall back to a neutral label — never the platform brand — if the tenant's
  // own name can't be resolved, so a real tenant never sees "Eynis" as their
  // workspace name.
  const [propertyName, setPropertyNameState] = useState<string>(initialPropertyName ?? "Workspace");
  const [branding, setBranding] = useState<TenantBranding | null>(initialBranding);
  const [whitelabelTier, setWhitelabelTier] = useState<string | null>(initialWhitelabelTier);
  const [impersonating, setImpersonating] = useState<Impersonating | null>(null);
  const [impModalOpen, setImpModalOpen] = useState(false);
  const [stoppingImp, setStoppingImp] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);

  // ── Fetch fresh context from server when user is loaded ──────────────────
  // The root layout may have rendered before sign-in (returning defaults),
  // so we re-fetch here once Clerk confirms the user is authenticated. This
  // also surfaces any active impersonation (resolved server-side from the cookie).
  useEffect(() => {
    if (!isLoaded || !user) return;
    fetch("/api/me", { cache: "no-store" })
      .then(r => r.json())
      .then((data: { ok: boolean; exists?: boolean; orgRole?: OrgRole; industry?: Industry; propertyName?: string | null; branding?: TenantBranding | null; whitelabelTier?: string | null; impersonating?: Impersonating | null; workspaces?: WorkspaceSummary[]; tenantId?: string | null }) => {
        if (data.ok && data.exists) {
          setBranding(data.branding ?? null);
          setWhitelabelTier(data.whitelabelTier ?? null);
          if (data.orgRole) setOrgRoleState(data.orgRole);
          if (data.industry) setIndustryState(data.industry);
          if (data.propertyName) setPropertyNameState(data.propertyName);
          setImpersonating(data.impersonating ?? null);
          setWorkspaces(data.workspaces ?? []);
          setActiveTenantId(data.tenantId ?? null);
        }
      })
      .catch(() => { /* fail silently — keep initial defaults */ });
  }, [isLoaded, user]);

  // Real notifications: the tenant's recent activity feed. Refetched whenever
  // the panel opens so it's current when the user actually looks at it.
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
  // Tier gates the deep overrides (font, sidebar token, hide "powered by").
  const theme = resolveTheme(branding, config, whitelabelTier);

  // ── Route guard ──────────────────────────────────────────────────────────
  const isPublicRoute =
    pathname.startsWith("/request") ||
    // Public customer quote link (Phase 6): pre-auth, tenant-brand-only surface.
    pathname.startsWith("/q/") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/onboarding") ||
    // Internal Eynis-staff provisioning console (E-8): not a tenant surface, so it
    // renders bare — no tenant sidebar, branding, or org-role route guard.
    pathname.startsWith("/admin");

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
    // Generated 12-step accent ramp (design-system Phase 1): --accent-1..12 +
    // --accent-contrast + role aliases, derived from the tenant hue with a
    // WCAG-AA guarantee (see lib/color/ramp.ts). Emitted for the ACTIVE theme
    // (Phase 2). Additive — the migration (Phases 4-6) moves components onto these.
    const ramp = accentRampToVars(buildAccentRamp(theme.primaryColor, themeMode));
    for (const [k, v] of Object.entries(ramp)) root.setProperty(k, v);
    // Deep white-label tokens (E-9, white_label tier). Removing the property when
    // null lets the default theme/font win — no stale override lingers.
    if (theme.sidebarColor) root.setProperty("--color-sidebar", theme.sidebarColor);
    else root.removeProperty("--color-sidebar");
    if (theme.fontFamily) root.setProperty("--font-brand", theme.fontFamily);
    else root.removeProperty("--font-brand");
  }, [theme.primaryColor, theme.accentColor, theme.sidebarColor, theme.fontFamily, themeMode]);

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

  // Lazily load the real notification feed the first time the bell is opened —
  // keeps it off the critical path for every page load.
  useEffect(() => {
    if (!notifOpen || notifLoaded || notifLoading) return;
    let cancelled = false;
    setNotifLoading(true);
    setNotifError(false);
    fetch("/api/notifications", { cache: "no-store" })
      .then(r => r.json())
      .then((data: { ok?: boolean; items?: Notif[] }) => {
        if (cancelled) return;
        if (data.ok && Array.isArray(data.items)) { setNotifs(data.items); setNotifLoaded(true); }
        else setNotifError(true);
      })
      .catch(() => { if (!cancelled) setNotifError(true); })
      .finally(() => { if (!cancelled) setNotifLoading(false); });
    return () => { cancelled = true; };
  }, [notifOpen, notifLoaded, notifLoading]);

  // Close the mobile nav drawer whenever the route changes (E-13e).
  useEffect(() => { setNavOpen(false); }, [pathname]);

  if (isPublicRoute) {
    return <div className="public-shell">{children}</div>;
  }

  const unreadCount = notifs.filter(n => !readIds.has(n.id)).length;
  const OverviewIcon = config.overviewIcon;
  const roleDef = SYSTEM_ROLES.find(r => r.key === orgRole)!;

  return (
    <div className="app-shell">
      {/* Per-tenant custom CSS (E-9, white_label tier). Server-sanitised on write
          (no <>/url()/@import/expression), and only present here for white_label
          tenants via resolveTheme — so the injection has no script/network reach. */}
      {theme.customCss && <style data-tenant-css="" dangerouslySetInnerHTML={{ __html: theme.customCss }} />}
      {/* Backdrop behind the mobile nav drawer (E-13e). */}
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      {/* Sidebar */}
      <aside className={`app-sidebar${navOpen ? " open" : ""}`}>
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
                  {theme.brandName ?? platformBrand}
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

        {/* Workspace switcher (multi-workspace membership). Hidden while
            impersonating — switching identities and workspaces at once is confusing. */}
        {!impersonating && workspaces.length > 0 && (
          <WorkspaceSwitcher workspaces={workspaces} activeTenantId={activeTenantId} accentColor={config.accentColor} />
        )}

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
      </aside>

      {/* Main */}
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-property">
            <button type="button" className="nav-toggle" onClick={() => setNavOpen(true)} aria-label="Open navigation">
              <Menu className="w-5 h-5" />
            </button>
            <span className="topbar-dot" style={{ background: config.accentColor }} />
            <span className="topbar-name">{config.name} Dashboard</span>
            <span className="text-slate-300 text-sm">|</span>
            <CalendarDays className="w-4 h-4 text-fg-muted" />
            <TopbarClock />
          </div>
          <div className="topbar-right">
            {/* Dark-mode toggle — gated until the component migration (Phase 6)
                makes dark mode complete for every surface, not just the shell. */}
            {process.env.NEXT_PUBLIC_ENABLE_THEME_TOGGLE === "true" && <ThemeToggle />}
            <div className="relative" ref={notifRef}>
              <button className="topbar-icon-btn" onClick={() => setNotifOpen(v => !v)}>
                <Bell className="w-4.5 h-4.5" />
                {unreadCount > 0 && <span className="topbar-badge">{unreadCount}</span>}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-11 w-80 bg-surface rounded-xl shadow-2xl border border-line z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-line">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-fg text-sm">Notifications</span>
                      {unreadCount > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium text-white" style={{ background: config.accentColor }}>
                          {unreadCount} new
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="text-xs text-fg-muted hover:text-fg-muted" onClick={() => setReadIds(new Set(notifs.map(n => n.id)))}>
                        Mark all read
                      </button>
                      <button onClick={() => setNotifOpen(false)} className="text-fg-muted hover:text-fg-muted">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-line max-h-80 overflow-y-auto">
                    {notifLoading && notifs.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-fg-subtle">Loading…</div>
                    )}
                    {!notifLoading && notifError && notifs.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-fg-subtle">Couldn&apos;t load notifications. Try again shortly.</div>
                    )}
                    {!notifLoading && !notifError && notifLoaded && notifs.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-fg-subtle">You&apos;re all caught up.</div>
                    )}
                    {notifs.map(n => {
                      const unread = !readIds.has(n.id);
                      return (
                        <Link
                          key={n.id}
                          href={n.href}
                          onClick={() => { setReadIds(prev => new Set([...prev, n.id])); setNotifOpen(false); }}
                          className={`block px-4 py-3 cursor-pointer transition-colors hover:bg-surface-inset ${unread ? "bg-info-bg/30" : ""}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.type === "alert" ? "bg-danger-solid" : n.type === "success" ? "bg-ok-solid" : "bg-info-solid"}`} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-fg capitalize">{n.title}</div>
                              <div className="text-xs text-fg-muted mt-0.5 leading-relaxed">{n.body}</div>
                              <div className="text-xs text-fg-muted mt-1">{relativeTime(n.at)}</div>
                            </div>
                            {unread && <div className="w-1.5 h-1.5 rounded-full bg-info-solid shrink-0 mt-2" />}
                          </div>
                        </Link>
                      );
                    })}
                  </div>

                  <div className="px-4 py-2.5 border-t border-line text-center">
                    <Link href="/dashboard" onClick={() => setNotifOpen(false)} className="text-xs font-medium hover:underline" style={{ color: config.accentColor }}>
                      View all activity
                    </Link>
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
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-surface/20 hover:bg-surface/30 disabled:opacity-60"
            >
              <ShieldOff className="w-3.5 h-3.5" />
              {stoppingImp ? "Stopping…" : "Stop impersonating"}
            </button>
          </div>
        )}

        {/* Access denied banner */}
        {accessDenied && (
          <div className="flex items-center gap-3 px-5 py-3 text-sm text-danger bg-danger-bg border-b border-danger-border">
            <ShieldAlert className="w-4 h-4 text-danger shrink-0" />
            <span>
              Access restricted — <strong>{ORG_ROLE_LABELS[orgRole]}</strong> role cannot view that page.
              Redirected to Dashboard.
            </span>
            <button onClick={() => setAccessDenied(false)} className="ml-auto text-danger hover:text-danger">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Honest "Preview" banner for vertical pages not yet backed by the API (F-19) */}
        {!isPublicRoute && isPreviewRoute(pathname) && (
          <div className="flex items-center gap-3 px-5 py-2.5 text-xs text-warn bg-warn-bg border-b border-warn-border">
            <span className="w-1.5 h-1.5 rounded-full bg-warn-solid shrink-0" />
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
