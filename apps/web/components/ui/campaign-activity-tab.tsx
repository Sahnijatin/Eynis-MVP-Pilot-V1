"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "./badge";

// Activity tab: a live feed of WhatsApp/email sends (MessageDelivery) backed by
// GET /campaigns/:id/deliveries. Polls every few seconds while the campaign is
// active so the operator can watch sends land in near-real-time.

interface DeliveryLead { firstName: string; lastName: string | null; company: string | null; phone: string | null }
interface Delivery {
  id: string; channel: string; status: string; renderedSubject: string | null; renderedBody: string | null;
  error: string | null; sentAt: string | null; createdAt: string; lead: DeliveryLead;
}

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  queued: "neutral", sent: "success", delivered: "success", replied: "success", failed: "danger",
};
const CHANNEL_ICON: Record<string, string> = { whatsapp: "💬", email: "✉️" };
const POLL_MS = 5000;

const timeAgo = (iso: string) => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

export function CampaignActivityTab({ campaignId, isActive }: { campaignId: string; isActive: boolean }) {
  const [items, setItems] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [live, setLive] = useState(isActive);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    // Also runs on a 5s poll — failures are swallowed (no toast spam); existing
    // items stay on screen and the next tick retries.
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/deliveries?limit=100`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) { setItems(data.items); setLoadFailed(false); }
      else setLoadFailed(true);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (live) timer.current = setInterval(() => { void load(); }, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [live, load]);

  if (loading) return <div style={muted}>Loading activity…</div>;

  return (
    <div style={card}>
      <div style={cardTitle}>
        <span>Activity feed ({items.length})</span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#666", fontWeight: 500 }}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          {live ? <span style={{ color: "#dc2626", fontWeight: 700 }}>● Live</span> : "Auto-refresh"}
        </label>
      </div>
      {items.length === 0 ? (
        <div style={{ textAlign: "center", padding: 32, color: loadFailed ? "#991b1b" : "#666" }}>
          {loadFailed
            ? "Couldn't load activity — check your connection. It retries automatically while auto-refresh is on."
            : "No messages sent yet. WhatsApp and email sends will stream in here."}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((d) => (
            <div key={d.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
              <div style={{ fontSize: 18 }}>{CHANNEL_ICON[d.channel] ?? "•"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{d.lead.firstName} {d.lead.lastName ?? ""}</span>
                  <span style={{ color: "#9ca3af", fontSize: 12, whiteSpace: "nowrap" }}>{timeAgo(d.createdAt)}</span>
                </div>
                <div style={{ color: "#6b7280", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.renderedSubject ?? d.renderedBody ?? (d.lead.company ?? d.lead.phone ?? "")}
                </div>
                {d.error && <div style={{ color: "#991b1b", fontSize: 12 }}>⚠ {d.error}</div>}
              </div>
              <Badge label={d.status} tone={STATUS_TONE[d.status] ?? "neutral"} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 16 };
const cardTitle: React.CSSProperties = { fontWeight: 600, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" };
const muted: React.CSSProperties = { color: "#9ca3af", padding: 16 };
