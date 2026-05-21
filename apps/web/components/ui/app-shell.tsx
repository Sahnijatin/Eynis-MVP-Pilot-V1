"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";
import {
  LayoutDashboard,
  TrendingUp,
  Bell,
  Users,
  Megaphone,
  Database,
  Zap,
  LineChart,
  Settings,
  Building2,
  CalendarDays,
  ChevronRight,
  FileText
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/revenue-intelligence", label: "Revenue Intelligence", icon: TrendingUp },
  { href: "/queue", label: "Service Requests", icon: Bell },
  { href: "/staff-performance", label: "Staff Performance", icon: Users },
  { href: "/upsell-campaigns", label: "Upsell Campaigns", icon: Megaphone },
  { href: "/guest-database", label: "Guest Database", icon: Database },
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/sentiment-trends", label: "Sentiment Trends", icon: LineChart },
  { href: "/night-audit", label: "Night Audit", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings }
];

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
  const isPublicRequest = pathname.startsWith("/request");

  if (isPublicRequest) {
    return <div className="public-shell">{children}</div>;
  }

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="app-sidebar">
        {/* Brand */}
        <div className="brand-block">
          <div className="brand-logo">
            <div className="brand-logo-icon">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="brand-title">Eynis</span>
          </div>
          <div className="brand-subtitle">Sovereign Concierge</div>
        </div>

        {/* Nav */}
        <nav className="sidebar-nav">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
            return (
              <Link key={href} href={href} className={`nav-link${active ? " active" : ""}`}>
                <Icon className="nav-icon" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="multi-property-badge">
            <Building2 className="w-3.5 h-3.5" />
            <span>Multi-Property</span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.1)", color: "#7a9bbf" }}>PHASE 3</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-property">
            <span className="topbar-dot" />
            <span className="topbar-name">The Riviera</span>
            <span className="text-slate-300 text-sm">|</span>
            <CalendarDays className="w-4 h-4 text-slate-400" />
            <TopbarClock />
          </div>
          <div className="topbar-right">
            <button className="topbar-icon-btn">
              <Bell className="w-4.5 h-4.5" />
              <span className="topbar-badge">3</span>
            </button>
            <div className="topbar-avatar">
              <div className="avatar-initials">VM</div>
              <div>
                <div className="avatar-name">Vikram Mehta</div>
                <div className="avatar-role">OWNER</div>
              </div>
            </div>
          </div>
        </header>
        <main className="content-shell">{children}</main>
      </div>
    </div>
  );
}
