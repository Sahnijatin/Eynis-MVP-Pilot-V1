"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CampaignDetail, LeadSegmentRow, MessageTemplateRow } from "../../lib/data";

// Settings tab: edit a campaign's core config + per-channel templates via
// PATCH /api/campaigns/:id. Only the fields most operators tweak post-creation
// are exposed here; full setup lives in the builder.

export function CampaignSettingsForm({ campaign }: { campaign: CampaignDetail }) {
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [defaultCountryCode, setCountry] = useState(campaign.defaultCountryCode);
  const [spendCapCalls, setSpendCap] = useState(campaign.spendCapCalls != null ? String(campaign.spendCapCalls) : "");
  const [maxConcurrent, setMaxConcurrent] = useState(String(campaign.maxConcurrent));
  const [agentName, setAgentName] = useState(campaign.agentName ?? "");
  const [calendlyLink, setCalendly] = useState(campaign.calendlyLink ?? "");
  const [whatsappTemplateBody, setWaBody] = useState(campaign.whatsappTemplateBody ?? "");
  const [emailSubjectTemplate, setEmailSubject] = useState(campaign.emailSubjectTemplate ?? "");
  const [emailBodyTemplate, setEmailBody] = useState(campaign.emailBodyTemplate ?? "");
  const [segmentId, setSegmentId] = useState(campaign.segmentId ?? "");
  const [segments, setSegments] = useState<LeadSegmentRow[]>([]);
  const [whatsappTemplateId, setWaTemplateId] = useState(campaign.whatsappTemplateId ?? "");
  const [waTemplates, setWaTemplates] = useState<MessageTemplateRow[]>([]);

  // Scheduling
  const [scheduledStart, setScheduledStart] = useState(toLocalInput(campaign.scheduledStartAt));
  const [windowEnabled, setWindowEnabled] = useState(campaign.sendWindowStartMin != null && campaign.sendWindowEndMin != null);
  const [windowStart, setWindowStart] = useState(minToHHMM(campaign.sendWindowStartMin ?? 540));
  const [windowEnd, setWindowEnd] = useState(minToHHMM(campaign.sendWindowEndMin ?? 1260));
  const [days, setDays] = useState<Set<number>>(new Set(campaign.sendDays ?? []));
  const [sendTimeZone, setTimeZone] = useState(campaign.sendTimeZone ?? "");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [segRes, tplRes] = await Promise.all([
          fetch("/api/segments", { cache: "no-store" }),
          fetch("/api/templates?channel=whatsapp&status=approved", { cache: "no-store" }),
        ]);
        const segData = await segRes.json();
        const tplData = await tplRes.json();
        if (alive && segData.ok) setSegments(segData.items);
        if (alive && tplData.ok) setWaTemplates(tplData.items);
      } catch { /* optional */ }
    })();
    return () => { alive = false; };
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const payload = {
        name: name.trim(),
        defaultCountryCode: defaultCountryCode.trim() || "+91",
        spendCapCalls: spendCapCalls.trim() ? Number(spendCapCalls) : null,
        maxConcurrent: Number(maxConcurrent) || 1,
        agentName: agentName.trim() || null,
        calendlyLink: calendlyLink.trim() || null,
        whatsappTemplateBody: whatsappTemplateBody.trim() || null,
        emailSubjectTemplate: emailSubjectTemplate.trim() || null,
        emailBodyTemplate: emailBodyTemplate.trim() || null,
        segmentId: segmentId || null,
        whatsappTemplateId: whatsappTemplateId || null,
        scheduledStartAt: scheduledStart ? new Date(scheduledStart).toISOString() : null,
        sendWindowStartMin: windowEnabled ? hhmmToMin(windowStart) : null,
        sendWindowEndMin: windowEnabled ? hhmmToMin(windowEnd) : null,
        sendDays: [...days].sort(),
        sendTimeZone: sendTimeZone.trim() || null,
      };
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMsg({ tone: "err", text: data.error ?? "Save failed" });
      } else {
        setMsg({ tone: "ok", text: "Saved" });
        router.refresh();
      }
    } catch {
      setMsg({ tone: "err", text: "Network error — try again" });
    } finally {
      setBusy(false);
    }
  }

  const channels = campaign.channels ?? [];

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 640 }}>
      <div style={card}>
        <div style={cardTitle}>General</div>
        <Field label="Campaign name"><input style={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Field label="Country code"><input style={input} value={defaultCountryCode} onChange={(e) => setCountry(e.target.value)} placeholder="+91" /></Field>
          <Field label="Spend cap (calls)"><input style={input} value={spendCapCalls} onChange={(e) => setSpendCap(e.target.value)} placeholder="unlimited" inputMode="numeric" /></Field>
          <Field label="Max concurrent"><input style={input} value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} inputMode="numeric" /></Field>
        </div>
        <Field label="Target segment">
          <select style={input} value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
            <option value="">All leads (no segment)</option>
            {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>
            When set, only leads matching the segment are contacted. Manage segments in <a href="/segments" style={{ color: "#0f766e" }}>Segments</a>.
          </div>
        </Field>
      </div>

      <div style={card}>
        <div style={cardTitle}>Schedule & send window</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Scheduled start (optional)">
            <input style={input} type="datetime-local" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} />
          </Field>
          <Field label="Timezone (IANA, optional)">
            <input style={input} value={sendTimeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="defaults to hotel tz" />
          </Field>
        </div>
        <Field label="Daily send window">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 8 }}>
            <input type="checkbox" checked={windowEnabled} onChange={(e) => setWindowEnabled(e.target.checked)} />
            Only contact leads between set hours (quiet-hours compliance, e.g. 09:00–21:00)
          </label>
          {windowEnabled && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input style={{ ...input, width: 130 }} type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
              <span style={{ color: "#666" }}>to</span>
              <input style={{ ...input, width: 130 }} type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
            </div>
          )}
        </Field>
        <Field label="Allowed days (none selected = every day)">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DOW.map((d, i) => (
              <button key={i} type="button" onClick={() => setDays((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                style={{ ...chip, ...(days.has(i) ? chipOn : {}) }}>{d}</button>
            ))}
          </div>
        </Field>
      </div>

      {channels.includes("voice") && (
        <div style={card}>
          <div style={cardTitle}>Voice</div>
          <Field label="Agent name"><input style={input} value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. Maya" /></Field>
          <Field label="Calendly link"><input style={input} value={calendlyLink} onChange={(e) => setCalendly(e.target.value)} placeholder="https://calendly.com/…" /></Field>
        </div>
      )}

      {channels.includes("whatsapp") && (
        <div style={card}>
          <div style={cardTitle}>WhatsApp</div>
          <Field label="Approved template">
            <select style={input} value={whatsappTemplateId} onChange={(e) => setWaTemplateId(e.target.value)}>
              <option value="">— select an approved template —</option>
              {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>
              {waTemplates.length === 0
                ? <>No approved WhatsApp templates yet. Create and get one approved in <a href="/templates" style={{ color: "#0f766e" }}>Templates</a> — required before a WhatsApp campaign can be activated.</>
                : <>Meta only allows sending pre-approved templates. Manage them in <a href="/templates" style={{ color: "#0f766e" }}>Templates</a>.</>}
            </div>
          </Field>
          <Field label="Template body (preview override)"><textarea style={{ ...input, minHeight: 70 }} value={whatsappTemplateBody} onChange={(e) => setWaBody(e.target.value)} placeholder="Hi {{1}}, …" /></Field>
        </div>
      )}

      {channels.includes("email") && (
        <div style={card}>
          <div style={cardTitle}>Email</div>
          <Field label="Subject"><input style={input} value={emailSubjectTemplate} onChange={(e) => setEmailSubject(e.target.value)} /></Field>
          <Field label="Body"><textarea style={{ ...input, minHeight: 100 }} value={emailBodyTemplate} onChange={(e) => setEmailBody(e.target.value)} /></Field>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={save} disabled={busy || !name.trim()} style={btnPrimary}>{busy ? "Saving…" : "Save changes"}</button>
        {msg && <span style={{ fontSize: 14, color: msg.tone === "ok" ? "#166534" : "#991b1b", fontWeight: 600 }}>{msg.text}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hhmmToMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
// ISO (UTC) → value for a <input type="datetime-local"> in the browser's local time.
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 16 };
const cardTitle: React.CSSProperties = { fontWeight: 600, marginBottom: 12 };
const lbl: React.CSSProperties = { display: "block", fontSize: 13, color: "#374151", fontWeight: 600, marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" };
const btnPrimary: React.CSSProperties = { background: "#0f766e", color: "#fff", padding: "9px 16px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 14 };
const chip: React.CSSProperties = { background: "#f3f4f6", color: "#374151", padding: "6px 12px", borderRadius: 999, border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 13 };
const chipOn: React.CSSProperties = { background: "#0f766e", color: "#fff", borderColor: "#0f766e" };
