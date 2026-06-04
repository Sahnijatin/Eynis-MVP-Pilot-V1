"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Reusable variable reference — shared across voice script, WhatsApp, and email.
const VARIABLE_GROUPS: Array<{ group: string; vars: string[] }> = [
  { group: "Lead", vars: ["{lead.firstName}", "{lead.lastName}", "{lead.company}", "{lead.jobTitle}", "{lead.email}", "{lead.phone}"] },
  { group: "Custom (from CSV)", vars: ["{lead.custom.YOUR_COLUMN}"] },
  { group: "Campaign", vars: ["{campaign.name}", "{campaign.calendlyLink}"] },
  { group: "Tenant", vars: ["{tenant.name}"] },
  { group: "Booking", vars: ["{booking.calendlyLink}"] },
];

const ELEVENLABS_VOICES = ["Rachel", "Aria", "Sarah", "Adam", "Elli"];
const ALL_CHANNELS: Array<{ key: "voice" | "whatsapp" | "email"; label: string; hint: string }> = [
  { key: "voice", label: "Voice (AI calling)", hint: "AI agent calls leads with an A/B-tested script" },
  { key: "whatsapp", label: "WhatsApp", hint: "Pre-approved template message" },
  { key: "email", label: "Email", hint: "Configurable subject + body" },
];

function TemplateField({
  label, value, onChange, rows = 4, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function insert(token: string) {
    const el = ref.current;
    if (!el) { onChange(value + token); return; }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length; });
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
      <div>
        <label style={lbl}>{label}</label>
        <textarea ref={ref} value={value} rows={rows} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} style={textarea} />
      </div>
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 8, background: "#fafafa", maxHeight: 200, overflow: "auto" }}>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>Click to insert</div>
        {VARIABLE_GROUPS.map((g) => (
          <div key={g.group} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: "#aaa", textTransform: "uppercase" }}>{g.group}</div>
            {g.vars.map((v) => (
              <button type="button" key={v} onClick={() => insert(v)} style={chip}>{v}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CampaignBuilder() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [channels, setChannels] = useState<Set<string>>(new Set(["whatsapp"]));
  // voice
  const [scriptTemplate, setScript] = useState("");
  const [voiceA, setVoiceA] = useState("Rachel");
  const [voiceB, setVoiceB] = useState("Aria");
  const [personaA, setPersonaA] = useState("Enthusiastic");
  const [personaB, setPersonaB] = useState("Sophisticated");
  const [agentName, setAgentName] = useState("");
  const [outcomeTypes, setOutcomeTypes] = useState("interested, not_now, not_interested");
  // whatsapp
  const [whatsappContentSid, setWaSid] = useState("");
  const [whatsappTemplateBody, setWaBody] = useState("");
  const [whatsappVariables, setWaVars] = useState("");
  const [whatsappAgentEnabled, setWaAgent] = useState(false);
  const [whatsappAgentPrompt, setWaAgentPrompt] = useState("");
  // email
  const [emailSubjectTemplate, setEmailSubject] = useState("");
  const [emailBodyTemplate, setEmailBody] = useState("");
  // shared
  const [calendlyLink, setCalendly] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState("5");
  const [spendCapCalls, setSpendCap] = useState("");
  const [defaultCountryCode, setCountry] = useState("+91");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(ch: string) {
    setChannels((prev) => {
      const next = new Set(prev);
      next.has(ch) ? next.delete(ch) : next.add(ch);
      return next;
    });
  }

  async function submit() {
    setError(null);
    if (!name.trim()) { setError("Campaign name is required"); return; }
    if (channels.size === 0) { setError("Select at least one channel"); return; }
    const payload: Record<string, unknown> = {
      name: name.trim(),
      channels: [...channels],
      calendlyLink: calendlyLink.trim() || null,
      maxConcurrent: Number(maxConcurrent) || 5,
      spendCapCalls: spendCapCalls.trim() ? Number(spendCapCalls) : null,
      defaultCountryCode: defaultCountryCode.trim() || "+91",
    };
    if (channels.has("voice")) {
      Object.assign(payload, {
        scriptTemplate, voiceA, voiceB, personaA, personaB,
        agentName: agentName.trim() || null,
        outcomeTypes: outcomeTypes.split(",").map((s) => s.trim()).filter(Boolean),
      });
    }
    if (channels.has("whatsapp")) {
      Object.assign(payload, {
        whatsappContentSid: whatsappContentSid.trim(),
        whatsappTemplateBody: whatsappTemplateBody.trim() || null,
        whatsappVariables: whatsappVariables.split("\n").map((s) => s.trim()).filter(Boolean),
        whatsappAgentEnabled,
        whatsappAgentPrompt: whatsappAgentPrompt.trim() || null,
      });
    }
    if (channels.has("email")) {
      Object.assign(payload, { emailSubjectTemplate, emailBodyTemplate });
    }

    setBusy(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Failed to create campaign"); return; }
      router.push(`/campaigns/${data.campaign.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <Link href="/campaigns" style={{ color: "#0f766e", fontSize: 14 }}>← Campaigns</Link>
      <h1 style={{ margin: "8px 0 20px", fontSize: 24 }}>New Campaign</h1>

      <section style={section}>
        <label style={lbl}>Campaign name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer Room Upgrade" style={input} />
      </section>

      <section style={section}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Channels</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {ALL_CHANNELS.map((c) => {
            const on = channels.has(c.key);
            return (
              <button type="button" key={c.key} onClick={() => toggle(c.key)}
                style={{ ...channelCard, borderColor: on ? "#0f766e" : "#e5e7eb", background: on ? "#f0fdfa" : "#fff" }}>
                <div style={{ fontWeight: 600 }}>{on ? "✓ " : ""}{c.label}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{c.hint}</div>
              </button>
            );
          })}
        </div>
      </section>

      {channels.has("voice") && (
        <section style={section}>
          <div style={sectionTitle}>Voice script & A/B voices</div>
          <TemplateField label="System prompt / script" value={scriptTemplate} onChange={setScript} rows={5}
            placeholder="You are calling {lead.firstName} from {tenant.name}…" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div><label style={lbl}>Variant A voice</label>
              <select value={voiceA} onChange={(e) => setVoiceA(e.target.value)} style={input}>{ELEVENLABS_VOICES.map((v) => <option key={v}>{v}</option>)}</select></div>
            <div><label style={lbl}>Variant B voice</label>
              <select value={voiceB} onChange={(e) => setVoiceB(e.target.value)} style={input}>{ELEVENLABS_VOICES.map((v) => <option key={v}>{v}</option>)}</select></div>
            <div><label style={lbl}>Persona A label</label><input value={personaA} onChange={(e) => setPersonaA(e.target.value)} style={input} /></div>
            <div><label style={lbl}>Persona B label</label><input value={personaB} onChange={(e) => setPersonaB(e.target.value)} style={input} /></div>
            <div><label style={lbl}>Agent name (intro)</label><input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="defaults to hotel name" style={input} /></div>
            <div><label style={lbl}>Outcome types (comma-separated)</label><input value={outcomeTypes} onChange={(e) => setOutcomeTypes(e.target.value)} style={input} /></div>
          </div>
        </section>
      )}

      {channels.has("whatsapp") && (
        <section style={section}>
          <div style={sectionTitle}>WhatsApp (pre-approved template)</div>
          <label style={lbl}>Approved template id (Twilio Content SID)</label>
          <input value={whatsappContentSid} onChange={(e) => setWaSid(e.target.value)} placeholder="HX…" style={input} />
          <div style={{ marginTop: 12 }}>
            <TemplateField label="Template body (for preview)" value={whatsappTemplateBody} onChange={setWaBody} rows={3}
              placeholder="Hi {lead.firstName}, …" />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={lbl}>Template variables — one per line, in order ({"{{1}}, {{2}}…"})</label>
            <textarea value={whatsappVariables} onChange={(e) => setWaVars(e.target.value)} rows={3}
              placeholder={"{lead.firstName}\n{campaign.calendlyLink}"} style={textarea} />
          </div>
          <div style={{ marginTop: 14, padding: 12, background: "#fafafa", borderRadius: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
              <input type="checkbox" checked={whatsappAgentEnabled} onChange={(e) => setWaAgent(e.target.checked)} />
              Enable two-way AI agent (reply to customer replies automatically)
            </label>
            {whatsappAgentEnabled && (
              <div style={{ marginTop: 10 }}>
                <label style={lbl}>How should the bot respond? (your instructions to the AI)</label>
                <textarea value={whatsappAgentPrompt} onChange={(e) => setWaAgentPrompt(e.target.value)} rows={4}
                  placeholder={"e.g. You are a warm, concise concierge for {tenant.name}. Answer questions about the offer, never make up prices, and if the guest is interested share the booking link."}
                  style={textarea} />
                <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>
                  This is the AI's system prompt — it fully controls tone & behaviour. Supports {"{variables}"}. Leave blank for a sensible default.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {channels.has("email") && (
        <section style={section}>
          <div style={sectionTitle}>Email</div>
          <label style={lbl}>Subject</label>
          <input value={emailSubjectTemplate} onChange={(e) => setEmailSubject(e.target.value)} placeholder="A special offer for {lead.firstName}" style={input} />
          <div style={{ marginTop: 12 }}>
            <TemplateField label="Body (HTML)" value={emailBodyTemplate} onChange={setEmailBody} rows={6}
              placeholder="<p>Hi {lead.firstName},</p>…" />
          </div>
        </section>
      )}

      <section style={section}>
        <div style={sectionTitle}>Delivery controls</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div><label style={lbl}>Calendly link</label><input value={calendlyLink} onChange={(e) => setCalendly(e.target.value)} style={input} /></div>
          <div><label style={lbl}>Max concurrent</label><input value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} type="number" min={0} style={input} /></div>
          <div><label style={lbl}>Spend cap (sends/dials)</label><input value={spendCapCalls} onChange={(e) => setSpendCap(e.target.value)} type="number" min={1} placeholder="optional" style={input} /></div>
          <div><label style={lbl}>Default country code</label><input value={defaultCountryCode} onChange={(e) => setCountry(e.target.value)} style={input} /></div>
        </div>
      </section>

      {error && <div style={{ color: "#991b1b", background: "#fee2e2", padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={submit} disabled={busy} style={btnPrimary}>{busy ? "Creating…" : "Create campaign"}</button>
        <Link href="/campaigns" style={btnGhost}>Cancel</Link>
      </div>
    </div>
  );
}

const section: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 18, marginBottom: 16 };
const sectionTitle: React.CSSProperties = { fontWeight: 600, marginBottom: 12, fontSize: 15 };
const lbl: React.CSSProperties = { display: "block", fontSize: 13, color: "#374151", marginBottom: 4, fontWeight: 500 };
const input: React.CSSProperties = { width: "100%", padding: "9px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14, boxSizing: "border-box" };
const textarea: React.CSSProperties = { ...input, fontFamily: "inherit", resize: "vertical" };
const chip: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 5, padding: "3px 6px", margin: "2px 0", fontSize: 11, cursor: "pointer", color: "#0f766e" };
const channelCard: React.CSSProperties = { flex: "1 1 220px", textAlign: "left", border: "2px solid #e5e7eb", borderRadius: 10, padding: 14, cursor: "pointer", background: "#fff" };
const btnPrimary: React.CSSProperties = { background: "#0f766e", color: "#fff", padding: "10px 18px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 14 };
const btnGhost: React.CSSProperties = { background: "#f3f4f6", color: "#374151", padding: "10px 18px", borderRadius: 8, fontWeight: 600, textDecoration: "none", border: "none", cursor: "pointer", fontSize: 14 };
