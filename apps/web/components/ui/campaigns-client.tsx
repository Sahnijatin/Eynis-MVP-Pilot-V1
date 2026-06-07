"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "./badge";
import { PageHeader, LinkButton, useToast } from "../ds";
import { CampaignsNav } from "./campaigns-nav";
import type { CampaignSummary } from "../../lib/data";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  draft: "neutral", active: "success", paused: "warning", completed: "neutral",
};

const CHANNEL_LABEL: Record<string, string> = { voice: "Voice", whatsapp: "WhatsApp", email: "Email" };

export function CampaignsClient({ items }: { items: CampaignSummary[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "activate" | "pause") {
    setBusy(id + action);
    try {
      const res = await fetch(`/api/campaigns/${id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) toast.push(data.error ?? "Action failed", "error");
      else { toast.push(action === "activate" ? "Campaign activated" : "Campaign paused", "success"); router.refresh(); }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
      <CampaignsNav active="/campaigns" />
      <PageHeader title="Campaigns" subtitle="Reach your leads by voice, WhatsApp, or email — with configurable templates."
        actions={<LinkButton variant="primary" href="/campaigns/new">+ New Campaign</LinkButton>} />

      {items.length === 0 ? (
        <div style={{ ...cardBox, textAlign: "center", padding: 48 }}>
          <p style={{ fontSize: 16, marginBottom: 8 }}>No campaigns yet.</p>
          <p style={{ color: "#666", marginBottom: 20 }}>Create your first multi-channel campaign to start reaching leads.</p>
          <Link href="/campaigns/new" style={btnPrimary}>+ New Campaign</Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th><th>Channels</th><th>Status</th>
                <th>Leads</th><th>Calls</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/campaigns/${c.id}`} style={{ fontWeight: 600, color: "var(--color-primary, #0f766e)" }}>{c.name}</Link></td>
                  <td>
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(c.channels ?? []).map((ch) => <Badge key={ch} label={CHANNEL_LABEL[ch] ?? ch} tone="neutral" />)}
                    </span>
                  </td>
                  <td><Badge label={c.status} tone={STATUS_TONE[c.status] ?? "neutral"} /></td>
                  <td>{c.stats?.totalLeads ?? 0}</td>
                  <td>{c.stats?.totalCalls ?? 0}</td>
                  <td style={{ textAlign: "right" }}>
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
const btnPrimary: React.CSSProperties = { background: "var(--color-primary, #0f766e)", color: "#fff", padding: "9px 16px", borderRadius: 8, fontWeight: 600, textDecoration: "none", border: "none", cursor: "pointer", fontSize: 14 };
const btnGhost: React.CSSProperties = { background: "#f3f4f6", color: "#374151", padding: "6px 12px", borderRadius: 6, fontWeight: 600, textDecoration: "none", border: "none", cursor: "pointer", fontSize: 13 };
