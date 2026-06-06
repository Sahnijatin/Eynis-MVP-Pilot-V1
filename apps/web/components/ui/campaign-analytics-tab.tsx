"use client";

import { useEffect, useState } from "react";
import { Badge } from "./badge";

// Analytics tab: A/B/N comparison cards backed by GET /campaigns/:id/analytics
// (per-arm funnel rates + sentiment, with a z-test-gated winner call).

interface VariantStats {
  key: string; label: string;
  dials: number; answered: number; interested: number; meetingsBooked: number;
  avgDurationSeconds: number | null; answerRate: number; interestRate: number;
  bookingRate: number; avgSentiment: number;
}
interface Analytics {
  ok: boolean;
  overall: { totalLeads: number; dials: number; answered: number; interested: number; meetingsBooked: number };
  variants: VariantStats[];
  leadingVariant: string | null; sufficientSample: boolean; confident: boolean;
  pValue: number; sampleNote: string;
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

export function CampaignAnalyticsTab({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/analytics`, { cache: "no-store" });
        const d = await res.json();
        if (alive) setData(d.ok ? d : null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [campaignId]);

  if (loading) return <div style={muted}>Loading analytics…</div>;
  if (!data) return <div style={{ ...card, color: "#666" }}>Analytics unavailable.</div>;

  const { overall, variants } = data;
  const single = variants.length <= 1;
  const leadingLabel = variants.find((v) => v.key === data.leadingVariant)?.label;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <Stat label="Leads" value={overall.totalLeads} />
        <Stat label="Dials" value={overall.dials} />
        <Stat label="Answered" value={overall.answered} />
        <Stat label="Interested" value={overall.interested} />
        <Stat label="Meetings" value={overall.meetingsBooked} />
      </div>

      <div style={card}>
        <div style={cardTitle}>{single ? "Result" : `Winner — ${variants.length}-arm test`}</div>
        {single ? (
          <div style={{ color: "#666" }}>Single variant — no A/B test running.</div>
        ) : data.leadingVariant === null ? (
          <div style={{ color: "#666" }}>No leading variant yet — the arms are even.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Badge label={`Variant ${data.leadingVariant}${leadingLabel ? ` · ${leadingLabel}` : ""} leads`} tone={data.confident ? "success" : "warning"} />
            <Badge label={data.confident ? "Statistically significant" : "Not yet significant"} tone={data.confident ? "success" : "neutral"} />
            <span style={{ color: "#666", fontSize: 13 }}>p = {data.pValue} · {data.sampleNote}</span>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {variants.map((v) => (
          <VariantCard key={v.key} name={v.key} label={v.label} v={v} leading={data.leadingVariant === v.key} confident={data.confident} />
        ))}
      </div>
    </div>
  );
}

function VariantCard({ name, label, v, leading, confident }: { name: string; label: string; v: VariantStats; leading: boolean; confident: boolean }) {
  return (
    <div style={{ ...card, borderColor: leading ? "#0f766e" : "#e5e7eb", borderWidth: leading ? 2 : 1 }}>
      <div style={{ ...cardTitle, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span>Variant {name}{label && label !== name ? ` · ${label}` : ""}</span>
        {leading && <Badge label={confident ? "Winner" : "Leading"} tone={confident ? "success" : "warning"} />}
      </div>
      <Row label="Dials" value={String(v.dials)} />
      <Row label="Answer rate" value={pct(v.answerRate)} />
      <Row label="Interest rate" value={pct(v.interestRate)} sub={`${v.interested}/${v.answered} answered`} />
      <Row label="Booking rate" value={pct(v.bookingRate)} sub={`${v.meetingsBooked} meetings`} />
      <Row label="Avg sentiment" value={v.avgSentiment.toFixed(2)} sub="−1 to +1" />
      <Row label="Avg duration" value={v.avgDurationSeconds == null ? "—" : `${Math.floor(v.avgDurationSeconds / 60)}m ${v.avgDurationSeconds % 60}s`} />
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
      <span style={{ color: "#666", fontSize: 13 }}>{label}</span>
      <span style={{ textAlign: "right" }}>
        <span style={{ fontWeight: 700 }}>{value}</span>
        {sub && <div style={{ color: "#9ca3af", fontSize: 11 }}>{sub}</div>}
      </span>
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
const muted: React.CSSProperties = { color: "#9ca3af", padding: 16 };
