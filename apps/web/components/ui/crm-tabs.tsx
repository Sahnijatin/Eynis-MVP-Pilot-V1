"use client";

// CRM sub-tab navigation (E-4). Renders the single CRM module's four surfaces —
// Contacts, Companies, Deals, Tasks — as tabs, shown at the top of each page so
// the four deep-link routes read as one module.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tokens as t } from "../ds";

const TABS = [
  { href: "/contacts", label: "Contacts" },
  { href: "/companies", label: "Companies" },
  { href: "/deals", label: "Deals" },
  { href: "/tasks", label: "Tasks" },
];

export function CrmTabs() {
  const pathname = usePathname();
  return (
    <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${t.color.border}`, marginBottom: 18 }}>
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link key={tab.href} href={tab.href} style={{
            padding: "9px 14px", fontSize: t.font.sm, fontWeight: 600, textDecoration: "none",
            color: active ? t.color.accent : t.color.textMuted,
            borderBottom: `2px solid ${active ? t.color.accent : "transparent"}`,
            marginBottom: -1,
          }}>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
