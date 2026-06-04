"use client";

import Link from "next/link";
import { tokens as t } from "../ds/tokens";

// Secondary navigation for the Campaigns area. Surfaces the sub-sections
// (Segments / Sequences / Templates) that previously hid behind a header link.
const ITEMS = [
  { href: "/campaigns", label: "Campaigns" },
  { href: "/segments", label: "Segments" },
  { href: "/sequences", label: "Sequences" },
  { href: "/templates", label: "Templates" },
];

export function CampaignsNav({ active }: { active: string }) {
  return (
    <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${t.color.border}`, marginBottom: 22 }}>
      {ITEMS.map((i) => {
        const on = i.href === active;
        return (
          <Link key={i.href} href={i.href} style={{
            padding: "9px 14px", fontSize: t.font.base, fontWeight: 600, textDecoration: "none",
            color: on ? t.color.accent : t.color.textMuted,
            borderBottom: on ? `2px solid ${t.color.accent}` : "2px solid transparent",
            marginBottom: -1,
          }}>{i.label}</Link>
        );
      })}
    </div>
  );
}
