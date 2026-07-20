"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "./badge";

// Calls tab: a list of call records with a detail panel that shows the live
// sentiment meter, the AI summary/key points, and the lead's WhatsApp thread.
// Data comes from GET /campaigns/:id/calls and /calls/:callId (via the web proxy).

interface CallLead { firstName: string; lastName: string | null; company: string | null; phone: string | null }
interface CallRow {
  id: string; abVariant: string; status: string; outcome: string | null; sentiment: string | null;
  durationSeconds: number | null; whatsappSent: boolean; emailSent: boolean; meetingBooked: boolean;
  createdAt: string; endedAt: string | null; lead: CallLead;
}
interface SentimentEvent { speaker: string; text: string; sentiment: string; score: number | null; createdAt: string }
interface ThreadMessage { direction: string; body: string; sentiment: string | null; createdAt: string }
interface CallDetail {
  id: string; status: string; outcome: string | null; sentiment: string | null; aiSummary: string | null;
  transcript: string | null; durationSeconds: number | null; keyPoints: string[]; lead: CallLead;
}

const SENT_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  positive: "success", neutral: "neutral", negative: "danger",
};
const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  initiated: "neutral", in_progress: "warning", ended: "success", failed: "danger",
};
const LIVE = new Set(["initiated", "in_progress"]);
const fmtDuration = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}m ${s % 60}s`);

export function CampaignCallsTab({ campaignId }: { campaignId: string }) {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/calls?limit=100`, { cache: "no-store" });
        const data = await res.json();
        if (alive) setCalls(data.ok ? data.items : []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [campaignId]);

  if (loading) return <div style={muted}>Loading calls…</div>;
  if (calls.length === 0) return <div style={{ ...card, textAlign: "center", padding: 32, color: "var(--text-muted)" }}>No calls yet. Calls appear here once a voice campaign is active and dialling.</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: 16 }}>
      <div style={card}>
        <div style={cardTitle}>
          Calls ({calls.length})
          <a href={`/api/campaigns/${campaignId}/calls?format=csv`} style={csvLink}>Export CSV</a>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lead</th><th>Variant</th><th>Status</th>
                <th>Outcome</th><th>Sentiment</th><th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} onClick={() => setSelected(c.id)}
                  style={{ cursor: "pointer", background: selected === c.id ? "#f0fdfa" : undefined }}>
                  <td>{c.lead.firstName} {c.lead.lastName ?? ""}<div style={{ color: "var(--text-subtle)", fontSize: 12 }}>{c.lead.company ?? c.lead.phone ?? ""}</div></td>
                  <td>{c.abVariant}</td>
                  <td><Badge label={c.status} tone={STATUS_TONE[c.status] ?? "neutral"} /></td>
                  <td>{c.outcome ?? "—"}</td>
                  <td>{c.sentiment ? <Badge label={c.sentiment} tone={SENT_TONE[c.sentiment] ?? "neutral"} /> : "—"}</td>
                  <td>{fmtDuration(c.durationSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {selected && <CallDetailPanel campaignId={campaignId} callId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CallDetailPanel({ campaignId, callId, onClose }: { campaignId: string; callId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [events, setEvents] = useState<SentimentEvent[]>([]);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/calls/${callId}`, { cache: "no-store" });
    const data = await res.json();
    if (data.ok) {
      setDetail(data.call);
      setEvents(data.sentimentEvents ?? []);
      setThread(data.whatsappThread ?? []);
    }
    setLoading(false);
  }, [campaignId, callId]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  // Live calls: poll the timeline so the sentiment meter updates in near-real-time.
  useEffect(() => {
    if (!detail || !LIVE.has(detail.status)) return;
    const t = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(t);
  }, [detail, load]);

  const live = detail ? LIVE.has(detail.status) : false;

  return (
    <div style={card}>
      <div style={{ ...cardTitle, display: "flex", justifyContent: "space-between" }}>
        <span>Call detail {live && <span style={livePill}>● LIVE</span>}</span>
        <button onClick={onClose} style={closeBtn}>✕</button>
      </div>
      {loading || !detail ? (
        <div style={muted}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{detail.lead.firstName} {detail.lead.lastName ?? ""}</div>
            <div style={{ color: "var(--text-subtle)", fontSize: 13 }}>{detail.lead.company ?? ""} · {detail.lead.phone ?? ""}</div>
          </div>

          <SentimentMeter events={events} finalSentiment={detail.sentiment} live={live} />

          {detail.aiSummary && (
            <div><div style={sub}>Summary</div><p style={{ margin: 0, fontSize: 14 }}>{detail.aiSummary}</p></div>
          )}
          {detail.keyPoints.length > 0 && (
            <div>
              <div style={sub}>Key points</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{detail.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </div>
          )}

          {thread.length > 0 && (
            <div>
              <div style={sub}>WhatsApp thread</div>
              <div style={{ display: "grid", gap: 6 }}>
                {thread.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: m.direction === "out" ? "flex-end" : "flex-start" }}>
                    <div style={{ ...bubble, background: m.direction === "out" ? "#dcf8c6" : "#f3f4f6" }}>{m.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Sentiment meter: maps the latest rolling score (or final sentiment) to a
// 0–100 position on a red→green track. Falls back to per-event sentiment when
// numeric scores aren't present.
function SentimentMeter({ events, finalSentiment, live }: { events: SentimentEvent[]; finalSentiment: string | null; live: boolean }) {
  const scored = events.filter((e) => e.score != null);
  let pct: number;
  if (scored.length > 0) {
    const latest = scored[scored.length - 1].score!; // expected roughly -1..1
    pct = Math.max(0, Math.min(100, (latest + 1) * 50));
  } else {
    const fallback = finalSentiment ?? events[events.length - 1]?.sentiment ?? "neutral";
    pct = fallback === "positive" ? 80 : fallback === "negative" ? 20 : 50;
  }
  const label = pct >= 66 ? "Positive" : pct <= 33 ? "Negative" : "Neutral";
  return (
    <div>
      <div style={{ ...sub, display: "flex", justifyContent: "space-between" }}>
        <span>{live ? "Live sentiment" : "Sentiment"}</span>
        <span style={{ fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ position: "relative", height: 10, borderRadius: 999, background: "linear-gradient(90deg,#ef4444,#f59e0b,#22c55e)" }}>
        <div style={{ position: "absolute", top: -3, left: `calc(${pct}% - 8px)`, width: 16, height: 16, borderRadius: "50%", background: "var(--surface)", border: "2px solid #0f766e", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
      </div>
      {scored.length === 0 && events.length === 0 && <div style={{ color: "var(--text-subtle)", fontSize: 12, marginTop: 6 }}>No sentiment events recorded yet.</div>}
    </div>
  );
}

const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 16 };
const cardTitle: React.CSSProperties = { fontWeight: 600, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" };
const sub: React.CSSProperties = { color: "var(--text-muted)", fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 };
const muted: React.CSSProperties = { color: "var(--text-subtle)", padding: 16 };
const bubble: React.CSSProperties = { maxWidth: "80%", padding: "8px 12px", borderRadius: 12, fontSize: 13 };
const closeBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text-subtle)" };
const csvLink: React.CSSProperties = { fontSize: 13, color: "var(--color-primary, #0f766e)", textDecoration: "none", fontWeight: 600 };
const livePill: React.CSSProperties = { color: "var(--danger-text)", fontSize: 12, fontWeight: 700, marginLeft: 8 };
