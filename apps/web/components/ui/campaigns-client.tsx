"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "./badge";
import type { CampaignSummary } from "../../lib/data";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  draft: "neutral", active: "success", paused: "warning", completed: "neutral",
};

const CHANNEL_LABEL: Record<string, string> = { voice: "Voice", whatsapp: "WhatsApp", email: "Email" };

export function CampaignsClient({ items }: { items: CampaignSummary[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "activate" | "pause") {
    setBusy(id + action);
    try {
      const res = await fetch(`/api/campaigns/${id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) alert(data.error ?? "Action failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Campaigns</h1>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: 14 }}>
            Reach your leads by voice, WhatsApp, or email — with configurable templates.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/segments" style={btnGhost}>Segments</Link>
          <Link href="/sequences" style={btnGhost}>Sequences</Link>
          <Link href="/templates" style={btnGhost}>Templates</Link>
          <Link href="/campaigns/new" style={btnPrimary}>+ New Campaign</Link>
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ ...cardBox, textAlign: "center", padding: 48 }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>No campaigns yet.</p>
          <p style={{ color: "#666", marginBottom: 20 }}>Create your first multi-channel campaign to start reaching leads.</p>
          <Link href="/campaigns/new" style={btnPrimary}>+ New Campaign</Link>
        </div>
      ) : (
        <div style={cardBox}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#666", borderBottom: "1px solid #eee" }}>
                <th style={th}>Name</th><th style={th}>Channels</th><th style={th}>Status</th>
                <th style={th}>Leads</th><th style={th}>Calls</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={td}><Link href={`/campaigns/${c.id}`} style={{ fontWeight: 600, color: "#0f766e" }}>{c.name}</Link></td>
                  <td style={td}>
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(c.channels ?? []).map((ch) => <Badge key={ch} label={CHANNEL_LABEL[ch] ?? ch} tone="neutral" />)}
                    </span>
                  </td>
                  <td style={td}><Badge label={c.status} tone={STATUS_TONE[c.status] ?? "neutral"} /></td>
                  <td style={td}>{c.stats?.totalLeads ?? 0}</td>
                  <td style={td}>{c.stats?.totalCalls ?? 0}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {c.status === "active" ? (
                      <button style={btnGhost} disabled={busy === c.id + "pause"} onClick={() => act(c.id, "pause")}>Pause</button>
                    ) : c.status === "draft" || c.status === "paused" ? (
                      <button style={btnGhost} disabled={busy === c.id + "activate"} onClick={() => act(c.id, "activate")}>Activate</button>
                    ) : null}
                    <Link href={`/campaigns/${c.id}`} style={{ ...btnGhost, marginLeft: 6 }}>Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const cardBox: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", overflow: "hidden" };
const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "12px 14px" };
const btnPrimary: React.CSSProperties = { background: "#0f766e", color: "#fff", padding: "9px 16px", borderRadius: 8, fontWeight: 600, textDecoration: "none", border: "none", cursor: "pointer", fontSize: 14 };
const btnGhost: React.CSSProperties = { background: "#f3f4f6", color: "#374151", padding: "6px 12px", borderRadius: 6, fontWeight: 600, textDecoration: "none", border: "none", cursor: "pointer", fontSize: 13 };
