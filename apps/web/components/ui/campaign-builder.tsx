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
  // voice — 1..N test variants (one = no test)
  const [scriptTemplate, setScript] = useState("");
  const [variants, setVariants] = useState<Array<{ label: string; voice: string; persona: string; weight: number }>>([
    { label: "Enthusiastic", voice: "Rachel", persona: "Enthusiastic", weight: 1 },
    { label: "Sophisticated", voice: "Aria", persona: "Sophisticated", weight: 1 },
  ]);
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

  const MAX_VARIANTS = 26;
  const VARIANT_KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function addVariant() {
    setVariants((prev) => prev.length >= MAX_VARIANTS ? prev
      : [...prev, { label: "", voice: ELEVENLABS_VOICES[prev.length % ELEVENLABS_VOICES.length], persona: "", weight: 1 }]);
  }
  function removeVariant(i: number) {
    setVariants((prev) => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i));
  }
  function updateVariant(i: number, patch: Partial<{ label: string; voice: string; persona: string; weight: number }>) {
    setVariants((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
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
      if (variants.some((v) => !v.persona.trim())) { setError("Each voice variant needs a persona"); return; }
      Object.assign(payload, {
        scriptTemplate,
        variants: variants.map((v) => ({
          label: v.label.trim() || v.persona.trim(),
          voice: v.voice,
          persona: v.persona.trim(),
          weight: Number(v.weight) > 0 ? Number(v.weight) : 1,
        })),
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
          <CardTitle>Voice script & test variants</CardTitle>
          <TemplateField label="System prompt / script" value={scriptTemplate} onChange={setScript} rows={5}
            placeholder="You are calling {lead.firstName} from {tenant.name}…" />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 8 }}>
            <Label>Test variants {variants.length > 1 ? `(${variants.length}-arm A/B test)` : "(single — no test)"}</Label>
            <button type="button" onClick={addVariant} disabled={variants.length >= MAX_VARIANTS}
              style={{ ...addBtn, opacity: variants.length >= MAX_VARIANTS ? 0.5 : 1 }}>+ Add variant</button>
          </div>
          <div style={{ fontSize: t.font.xs, color: t.color.textMuted, marginBottom: 10 }}>
            Leads are split across variants in proportion to their weight. One variant means no A/B test.
          </div>

          {variants.map((v, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 80px 32px", gap: 10, alignItems: "end", marginBottom: 10 }}>
              <div style={{ ...variantKeyBadge }}>{VARIANT_KEYS[i] ?? `V${i + 1}`}</div>
              <Field label="Persona label"><Input value={v.persona} onChange={(e) => updateVariant(i, { persona: e.target.value, label: e.target.value })} placeholder="e.g. Enthusiastic" /></Field>
              <Field label="Voice"><Select value={v.voice} onChange={(e) => updateVariant(i, { voice: e.target.value })}>{ELEVENLABS_VOICES.map((vo) => <option key={vo}>{vo}</option>)}</Select></Field>
              <Field label="Weight"><Input type="number" value={String(v.weight)} onChange={(e) => updateVariant(i, { weight: Math.max(1, Number(e.target.value) || 1) })} /></Field>
              <button type="button" onClick={() => removeVariant(i)} disabled={variants.length <= 1}
                title="Remove variant" style={{ ...removeBtn, opacity: variants.length <= 1 ? 0.3 : 1 }}>✕</button>
            </div>
          ))}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
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
const addBtn: React.CSSProperties = { background: t.color.accentSoft, color: t.color.accent, border: `1px solid ${t.color.accent}`, borderRadius: t.radius.md, padding: "5px 12px", fontSize: t.font.sm, fontWeight: 600, cursor: "pointer" };
const removeBtn: React.CSSProperties = { background: "transparent", color: t.color.textMuted, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, height: 38, cursor: "pointer", fontSize: 13 };
const variantKeyBadge: React.CSSProperties = { width: 28, height: 38, display: "flex", alignItems: "center", justifyContent: "center", background: t.color.accentSoft, color: t.color.accent, borderRadius: t.radius.md, fontWeight: 700, fontSize: t.font.sm };
