"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CampaignDetail } from "../../lib/data";

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

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

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
          <Field label="Template body"><textarea style={{ ...input, minHeight: 80 }} value={whatsappTemplateBody} onChange={(e) => setWaBody(e.target.value)} placeholder="Hi {{1}}, …" /></Field>
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

const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 16 };
const cardTitle: React.CSSProperties = { fontWeight: 600, marginBottom: 12 };
const lbl: React.CSSProperties = { display: "block", fontSize: 13, color: "#374151", fontWeight: 600, marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" };
const btnPrimary: React.CSSProperties = { background: "#0f766e", color: "#fff", padding: "9px 16px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 14 };
