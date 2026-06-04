"use client";

import { useEffect, useRef, useState } from "react";
import type { MessageTemplateRow } from "../../lib/data";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, LinkButton, Card, CardTitle, Field, Label, Input, Select, useToast, tokens as t } from "../ds";

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

const textareaStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", border: `1px solid ${t.color.borderStrong}`, borderRadius: t.radius.md,
  fontSize: t.font.base, boxSizing: "border-box", fontFamily: "inherit", resize: "vertical", color: t.color.text, outline: "none",
};

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
        <Label>{label}</Label>
        <textarea ref={ref} value={value} rows={rows} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} style={textareaStyle} />
      </div>
      <div style={{ border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, padding: 8, background: t.color.bg, maxHeight: 200, overflow: "auto" }}>
        <div style={{ fontSize: t.font.xs, color: t.color.textMuted, marginBottom: 6 }}>Click to insert</div>
        {VARIABLE_GROUPS.map((g) => (
          <div key={g.group} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: t.color.textFaint, textTransform: "uppercase", letterSpacing: 0.4 }}>{g.group}</div>
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
  const toast = useToast();
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
  const [whatsappTemplateId, setWaTemplateId] = useState("");
  const [waTemplates, setWaTemplates] = useState<MessageTemplateRow[]>([]);
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/templates?channel=whatsapp&status=approved", { cache: "no-store" });
        const data = await res.json();
        if (alive && data.ok) setWaTemplates(data.items);
      } catch { /* optional */ }
    })();
    return () => { alive = false; };
  }, []);

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
        whatsappTemplateId: whatsappTemplateId || null,
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
      toast.push("Campaign created", "success");
      router.push(`/campaigns/${data.campaign.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 28, maxWidth: 980, margin: "0 auto" }}>
      <Link href="/campaigns" style={{ color: t.color.accent, fontSize: t.font.base, fontWeight: 600, textDecoration: "none" }}>← Campaigns</Link>
      <h1 style={{ margin: "12px 0 22px", fontSize: t.font.xxl, fontWeight: 700, letterSpacing: -0.3 }}>New Campaign</h1>

      <Card style={{ marginBottom: 16 }}>
        <Field label="Campaign name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Summer Room Upgrade" /></Field>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <CardTitle>Channels</CardTitle>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {ALL_CHANNELS.map((c) => {
            const on = channels.has(c.key);
            return (
              <button type="button" key={c.key} onClick={() => toggle(c.key)}
                style={{ ...channelCard, borderColor: on ? t.color.accent : t.color.border, background: on ? t.color.accentSoft : t.color.surface }}>
                <div style={{ fontWeight: 600, color: t.color.text }}>{on ? "✓ " : ""}{c.label}</div>
                <div style={{ fontSize: t.font.xs, color: t.color.textMuted, marginTop: 4 }}>{c.hint}</div>
              </button>
            );
          })}
        </div>
      </Card>

      {channels.has("voice") && (
        <Card style={{ marginBottom: 16 }}>
          <CardTitle>Voice script & A/B voices</CardTitle>
          <TemplateField label="System prompt / script" value={scriptTemplate} onChange={setScript} rows={5}
            placeholder="You are calling {lead.firstName} from {tenant.name}…" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <Field label="Variant A voice"><Select value={voiceA} onChange={(e) => setVoiceA(e.target.value)}>{ELEVENLABS_VOICES.map((v) => <option key={v}>{v}</option>)}</Select></Field>
            <Field label="Variant B voice"><Select value={voiceB} onChange={(e) => setVoiceB(e.target.value)}>{ELEVENLABS_VOICES.map((v) => <option key={v}>{v}</option>)}</Select></Field>
            <Field label="Persona A label"><Input value={personaA} onChange={(e) => setPersonaA(e.target.value)} /></Field>
            <Field label="Persona B label"><Input value={personaB} onChange={(e) => setPersonaB(e.target.value)} /></Field>
            <Field label="Agent name (intro)"><Input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="defaults to hotel name" /></Field>
            <Field label="Outcome types (comma-separated)"><Input value={outcomeTypes} onChange={(e) => setOutcomeTypes(e.target.value)} /></Field>
          </div>
        </Card>
      )}

      {channels.has("whatsapp") && (
        <Card style={{ marginBottom: 16 }}>
          <CardTitle>WhatsApp (pre-approved template)</CardTitle>
          <Field label="Approved template" hint={waTemplates.length === 0
            ? <>No approved templates yet — create one in <a href="/templates" style={{ color: t.color.accent }}>Templates</a>. WhatsApp campaigns can&apos;t be activated without an approved template (Meta requirement).</>
            : <>Required to activate. Manage in <a href="/templates" style={{ color: t.color.accent }}>Templates</a>.</>}>
            <Select value={whatsappTemplateId} onChange={(e) => setWaTemplateId(e.target.value)}>
              <option value="">— select an approved template —</option>
              {waTemplates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
            </Select>
          </Field>
          <Field label="Legacy: raw Content SID (optional, advanced)"><Input value={whatsappContentSid} onChange={(e) => setWaSid(e.target.value)} placeholder="HX…" /></Field>
          <div style={{ marginBottom: 14 }}>
            <TemplateField label="Template body (for preview)" value={whatsappTemplateBody} onChange={setWaBody} rows={3}
              placeholder="Hi {lead.firstName}, …" />
          </div>
          <Field label={`Template variables — one per line, in order ({{1}}, {{2}}…)`}>
            <textarea value={whatsappVariables} onChange={(e) => setWaVars(e.target.value)} rows={3}
              placeholder={"{lead.firstName}\n{campaign.calendlyLink}"} style={textareaStyle} />
          </Field>
          <div style={{ marginTop: 4, padding: 12, background: t.color.bg, borderRadius: t.radius.md, border: `1px solid ${t.color.border}` }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: t.font.base, fontWeight: 600 }}>
              <input type="checkbox" checked={whatsappAgentEnabled} onChange={(e) => setWaAgent(e.target.checked)} />
              Enable two-way AI agent (reply to customer replies automatically)
            </label>
            {whatsappAgentEnabled && (
              <div style={{ marginTop: 10 }}>
                <Label>How should the bot respond? (your instructions to the AI)</Label>
                <textarea value={whatsappAgentPrompt} onChange={(e) => setWaAgentPrompt(e.target.value)} rows={4}
                  placeholder={"e.g. You are a warm, concise concierge for {tenant.name}. Answer questions about the offer, never make up prices, and if the guest is interested share the booking link."}
                  style={textareaStyle} />
                <p style={{ fontSize: t.font.xs, color: t.color.textMuted, margin: "6px 0 0" }}>
                  This is the AI&apos;s system prompt — it fully controls tone & behaviour. Supports {"{variables}"}. Leave blank for a sensible default.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      {channels.has("email") && (
        <Card style={{ marginBottom: 16 }}>
          <CardTitle>Email</CardTitle>
          <Field label="Subject"><Input value={emailSubjectTemplate} onChange={(e) => setEmailSubject(e.target.value)} placeholder="A special offer for {lead.firstName}" /></Field>
          <div style={{ marginTop: 4 }}>
            <TemplateField label="Body (HTML)" value={emailBodyTemplate} onChange={setEmailBody} rows={6}
              placeholder="<p>Hi {lead.firstName},</p>…" />
          </div>
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <CardTitle>Delivery controls</CardTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <Field label="Calendly link"><Input value={calendlyLink} onChange={(e) => setCalendly(e.target.value)} /></Field>
          <Field label="Max concurrent"><Input value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} type="number" min={0} /></Field>
          <Field label="Spend cap (sends/dials)"><Input value={spendCapCalls} onChange={(e) => setSpendCap(e.target.value)} type="number" min={1} placeholder="optional" /></Field>
          <Field label="Default country code"><Input value={defaultCountryCode} onChange={(e) => setCountry(e.target.value)} /></Field>
        </div>
      </Card>

      {error && <div style={{ color: t.color.danger, background: t.color.dangerSoft, padding: 10, borderRadius: t.radius.md, marginBottom: 12, fontSize: t.font.sm }}>{error}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create campaign"}</Button>
        <LinkButton variant="secondary" href="/campaigns">Cancel</LinkButton>
      </div>
    </div>
  );
}

const chip: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: 5, padding: "3px 6px", margin: "2px 0", fontSize: 11, cursor: "pointer", color: t.color.accent };
const channelCard: React.CSSProperties = { flex: "1 1 220px", textAlign: "left", border: `2px solid ${t.color.border}`, borderRadius: t.radius.md, padding: 14, cursor: "pointer", background: t.color.surface };
