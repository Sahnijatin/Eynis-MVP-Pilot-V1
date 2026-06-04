"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "./badge";
import { Button, LinkButton, Card, CardTitle, useToast, tokens as t } from "../ds";
import { CampaignCallsTab } from "./campaign-calls-tab";
import { CampaignAnalyticsTab } from "./campaign-analytics-tab";
import { CampaignActivityTab } from "./campaign-activity-tab";
import { CampaignSettingsForm } from "./campaign-settings-form";
import { CampaignLeadsTab } from "./campaign-leads-tab";
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
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);

  async function act(action: "activate" | "pause" | "complete") {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) toast.push(data.error ?? "Action failed", "error");
      else { toast.push(`Campaign ${action === "activate" ? "activated" : action === "pause" ? "paused" : "completed"}`, "success"); router.refresh(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
      <Link href="/campaigns" style={{ color: t.color.accent, fontSize: t.font.base, fontWeight: 600, textDecoration: "none" }}>← Campaigns</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0 18px", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: t.font.xxl, fontWeight: 700, letterSpacing: -0.3 }}>{campaign.name}</h1>
          <Badge label={campaign.status} tone={STATUS_TONE[campaign.status] ?? "neutral"} />
          {(campaign.channels ?? []).map((c) => <Badge key={c} label={CHANNEL_LABEL[c] ?? c} tone="neutral" />)}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <LinkButton variant="secondary" href={`/campaigns/${campaign.id}/leads/import`}>Import leads</LinkButton>
          {campaign.status === "active"
            ? <Button onClick={() => act("pause")} disabled={busy}>Pause</Button>
            : (campaign.status === "draft" || campaign.status === "paused")
              ? <Button onClick={() => act("activate")} disabled={busy}>Activate</Button>
              : null}
        </div>
      </div>

      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${t.color.border}`, marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            style={{ background: "none", border: "none", padding: "9px 14px", fontWeight: 600, cursor: "pointer", fontSize: t.font.base, marginBottom: -1,
              borderBottom: tab === tb ? `2px solid ${t.color.accent}` : "2px solid transparent", color: tab === tb ? t.color.accent : t.color.textMuted }}>
            {tb === "leads" ? `Leads (${leadTotal})` : TAB_LABEL[tb]}
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
            <Card>
              <CardTitle>Lead status</CardTitle>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.entries(stats.leadStatusBreakdown).map(([k, v]) => (
                  <Badge key={k} label={`${k}: ${v}`} tone={STATUS_TONE[k] ?? "neutral"} />
                ))}
              </div>
            </Card>
          )}
          {stats && Object.keys(stats.outcomeBreakdown).length > 0 && (
            <Card>
              <CardTitle>Call outcomes</CardTitle>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.entries(stats.outcomeBreakdown).map(([k, v]) => <Badge key={k} label={`${k}: ${v}`} />)}
              </div>
            </Card>
          )}
        </div>
      ) : (
        <CampaignLeadsTab campaignId={campaign.id} initialLeads={leads} initialTotal={leadTotal} />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ color: t.color.textMuted, fontSize: t.font.sm }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: t.color.text }}>{value}</div>
    </Card>
  );
}
