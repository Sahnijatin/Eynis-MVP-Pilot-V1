"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { Bell, Building2, CalendarDays, X } from "lucide-react";
import { useUser, UserButton } from "@clerk/nextjs";
import { getIndustryConfig, type Industry } from "../../lib/industry-config";

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

function TopbarClock() {
  const [display, setDisplay] = useState<string | null>(null);

  useEffect(() => {
    function tick() {
      const now = new Date();
      setDisplay(
        now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
        " • " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      );
    }
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  if (!display) return null;
  return <span className="topbar-date">{display}</span>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useUser();
  const [notifOpen, setNotifOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const notifRef = useRef<HTMLDivElement>(null);

  const industry = (user?.unsafeMetadata?.industry as Industry) ?? "hospitality";
  const config = getIndustryConfig(industry);
  const notifs: Notif[] = NOTIFS[industry] ?? NOTIFS.hospitality;
  const unreadCount = notifs.filter(n => !readIds.has(n.id)).length;

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

  const isPublicRoute =
    pathname.startsWith("/request") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/onboarding");

  useEffect(() => {
    document.documentElement.style.setProperty("--color-industry", config.accentColor);
  }, [config.accentColor]);

  if (isPublicRoute) {
    return <div className="public-shell">{children}</div>;
  }

  const OverviewIcon = config.overviewIcon;

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="app-sidebar">
        <div className="brand-block">
          <div className="brand-logo">
            <div className="brand-logo-icon" style={{ background: config.accentColor }}>
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="brand-title">Eynis</span>
          </div>
          <div className="brand-subtitle">{config.tagline}</div>
        </div>

        <div className="sidebar-industry-badge" style={{ borderColor: config.accentColor + "33", background: config.accentColor + "11" }}>
          <OverviewIcon className="w-3.5 h-3.5" style={{ color: config.accentColor }} />
          <span style={{ color: config.accentColor }}>{config.name}</span>
        </div>

        <nav className="sidebar-nav">
          {config.navItems.map(({ href, label, icon: Icon }) => {
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
          <div className="multi-property-badge">
            <Building2 className="w-3.5 h-3.5" />
            <span>Multi-{config.terminology.property}</span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.1)", color: "#7a9bbf" }}>
              PHASE 3
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
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
            {/* Notification bell with dropdown */}
            <div className="relative" ref={notifRef}>
              <button
                className="topbar-icon-btn"
                onClick={() => setNotifOpen(v => !v)}
              >
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
                      <button
                        className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                        onClick={() => setReadIds(new Set(notifs.map(n => n.id)))}
                      >
                        Mark all read
                      </button>
                      <button onClick={() => setNotifOpen(false)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
                    {notifs.map((n) => {
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
                    <button className="text-xs font-medium hover:underline transition-colors" style={{ color: config.accentColor }}>
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
        <main className="content-shell">{children}</main>
      </div>
    </div>
  );
}
