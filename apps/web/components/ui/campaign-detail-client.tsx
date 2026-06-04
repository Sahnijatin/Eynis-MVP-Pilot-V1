"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "./badge";
import { CampaignCallsTab } from "./campaign-calls-tab";
import { CampaignAnalyticsTab } from "./campaign-analytics-tab";
import { CampaignActivityTab } from "./campaign-activity-tab";
import { CampaignSettingsForm } from "./campaign-settings-form";
import type { CampaignDetail, CampaignLeadRow } from "../../lib/data";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  draft: "neutral", active: "success", paused: "warning", completed: "neutral",
  pending: "neutral", called: "success", failed: "danger", opted_out: "danger",
};
const CHANNEL_LABEL: Record<string, string> = { voice: "Voice", whatsapp: "WhatsApp", email: "Email" };

type Tab = "overview" | "leads" | "calls" | "analytics" | "activity" | "settings";
const TABS: Tab[] = ["overview", "leads", "calls", "analytics", "activity", "settings"];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview", leads: "Leads", calls: "Calls", analytics: "Analytics", activity: "Activity", settings: "Settings",
};

export function CampaignDetailClient({
  campaign, stats, leads, leadTotal,
}: {
  campaign: CampaignDetail;
  stats?: { totalLeads: number; totalCalls: number; outcomeBreakdown: Record<string, number>; leadStatusBreakdown: Record<string, number> };
  leads: CampaignLeadRow[];
  leadTotal: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);

  async function act(action: "activate" | "pause" | "complete") {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) alert(data.error ?? "Action failed");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <Link href="/campaigns" style={{ color: "#0f766e", fontSize: 14 }}>← Campaigns</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>{campaign.name}</h1>
          <Badge label={campaign.status} tone={STATUS_TONE[campaign.status] ?? "neutral"} />
          {(campaign.channels ?? []).map((c) => <Badge key={c} label={CHANNEL_LABEL[c] ?? c} tone="neutral" />)}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={`/campaigns/${campaign.id}/leads/import`} style={btnGhost}>Import leads</Link>
          {campaign.status === "active"
            ? <button onClick={() => act("pause")} disabled={busy} style={btnPrimary}>Pause</button>
            : (campaign.status === "draft" || campaign.status === "paused")
              ? <button onClick={() => act("activate")} disabled={busy} style={btnPrimary}>Activate</button>
              : null}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e7eb", marginBottom: 18, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...tabBtn, borderBottom: tab === t ? "2px solid #0f766e" : "2px solid transparent", color: tab === t ? "#0f766e" : "#666" }}>
            {t === "overview" ? "Overview" : t === "leads" ? `Leads (${leadTotal})` : TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "calls" ? (
        <CampaignCallsTab campaignId={campaign.id} />
      ) : tab === "analytics" ? (
        <CampaignAnalyticsTab campaignId={campaign.id} />
      ) : tab === "activity" ? (
        <CampaignActivityTab campaignId={campaign.id} isActive={campaign.status === "active"} />
      ) : tab === "settings" ? (
        <CampaignSettingsForm campaign={campaign} />
      ) : tab === "overview" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <Stat label="Total leads" value={stats?.totalLeads ?? 0} />
            <Stat label="Calls" value={stats?.totalCalls ?? 0} />
            <Stat label="Channels" value={(campaign.channels ?? []).length} />
            <Stat label="Spend cap" value={campaign.spendCapCalls ?? "—"} />
          </div>
          {stats && Object.keys(stats.leadStatusBreakdown).length > 0 && (
            <div style={card}>
              <div style={cardTitle}>Lead status</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.entries(stats.leadStatusBreakdown).map(([k, v]) => (
                  <Badge key={k} label={`${k}: ${v}`} tone={STATUS_TONE[k] ?? "neutral"} />
                ))}
              </div>
            </div>
          )}
          {stats && Object.keys(stats.outcomeBreakdown).length > 0 && (
            <div style={card}>
              <div style={cardTitle}>Call outcomes</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.entries(stats.outcomeBreakdown).map(([k, v]) => <Badge key={k} label={`${k}: ${v}`} />)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={card}>
          {leads.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32 }}>
              <p style={{ color: "#666", marginBottom: 16 }}>No leads imported yet.</p>
              <Link href={`/campaigns/${campaign.id}/leads/import`} style={btnPrimary}>Import leads from CSV</Link>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#666", borderBottom: "1px solid #eee" }}>
                  <th style={th}>Name</th><th style={th}>Company</th><th style={th}>Phone</th>
                  <th style={th}>Variant</th><th style={th}>Status</th><th style={th}>Consent</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={td}>{l.firstName} {l.lastName ?? ""}</td>
                    <td style={td}>{l.company ?? "—"}</td>
                    <td style={td}>{l.phone ?? "—"}</td>
                    <td style={td}>{l.abVariant ?? "—"}</td>
                    <td style={td}><Badge label={l.status} tone={STATUS_TONE[l.status] ?? "neutral"} /></td>
                    <td style={td}>{l.optedOut ? <Badge label="opted out" tone="danger" /> : l.consent ? "✓" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={{ color: "#666", fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 16 };
const cardTitle: React.CSSProperties = { fontWeight: 600, marginBottom: 10 };
const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "12px 14px" };
const tabBtn: React.CSSProperties = { background: "none", border: "none", padding: "10px 16px", fontWeight: 600, cursor: "pointer", fontSize: 14 };
const btnPrimary: React.CSSProperties = { background: "#0f766e", color: "#fff", padding: "9px 16px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 14 };
const btnGhost: React.CSSProperties = { background: "#f3f4f6", color: "#374151", padding: "9px 16px", borderRadius: 8, fontWeight: 600, textDecoration: "none", border: "none", cursor: "pointer", fontSize: 14 };
