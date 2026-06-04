"use client";

import { useState } from "react";
import { Badge } from "./badge";
import type { MessageTemplateRow } from "../../lib/data";

// Message template library: author reusable WhatsApp/email templates and track
// the WhatsApp approval lifecycle (draft → submitted → approved/rejected). Once
// approved, the recorded Content SID is what campaigns/sequences reference.

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  draft: "neutral", submitted: "warning", approved: "success", rejected: "danger",
};

export function TemplatesClient({ initialTemplates }: { initialTemplates: MessageTemplateRow[] }) {
  const [templates, setTemplates] = useState<MessageTemplateRow[]>(initialTemplates);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [category, setCategory] = useState("marketing");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [variables, setVariables] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function replace(t: MessageTemplateRow) { setTemplates((ts) => ts.map((x) => (x.id === t.id ? t : x))); }

  async function create() {
    if (!name.trim() || !body.trim()) { setError("Name and body are required"); return; }
    setBusy(true); setError(null);
    try {
      const payload = { name: name.trim(), channel, category, subject: subject.trim() || null, body: body.trim(), variables: variables.split(",").map((v) => v.trim()).filter(Boolean) };
      const res = await fetch("/api/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Create failed"); return; }
      setTemplates((ts) => [data.template, ...ts]);
      setName(""); setSubject(""); setBody(""); setVariables(""); setCreating(false);
    } finally { setBusy(false); }
  }

  async function submit(id: string) {
    const res = await fetch(`/api/templates/${id}/submit`, { method: "POST" });
    const data = await res.json();
    if (data.ok) replace(data.template);
  }
  async function setStatus(id: string, status: "approved" | "rejected") {
    const extra: Record<string, string> = {};
    if (status === "approved") {
      const sid = prompt("Approved Content SID / provider template id (from Twilio/Meta):");
      if (!sid) return;
      extra.providerTemplateId = sid;
    } else {
      extra.rejectionReason = prompt("Rejection reason (optional):") ?? "";
    }
    const res = await fetch(`/api/templates/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, ...extra }) });
    const data = await res.json();
    if (data.ok) replace(data.template); else alert(data.error ?? "Failed");
  }
  async function remove(id: string) {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    setTemplates((ts) => ts.filter((x) => x.id !== id));
  }

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Message templates</h1>
          <p style={{ color: "#666", margin: "4px 0 0", fontSize: 14 }}>Reusable WhatsApp/email content. WhatsApp templates need Meta/Twilio approval — track that here and record the approved Content SID.</p>
        </div>
        {!creating && <button onClick={() => setCreating(true)} style={btnPrimary}>+ New template</button>}
      </div>

      {creating && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={cardTitle}>New template</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
            <Field label="Name"><input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Welcome message" /></Field>
            <Field label="Channel">
              <select style={input} value={channel} onChange={(e) => setChannel(e.target.value as "whatsapp" | "email")}>
                <option value="whatsapp">WhatsApp</option><option value="email">Email</option>
              </select>
            </Field>
            <Field label="Category">
              <select style={input} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="marketing">Marketing</option><option value="utility">Utility</option><option value="authentication">Authentication</option>
              </select>
            </Field>
          </div>
          {channel === "email" && <Field label="Subject"><input style={input} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
          <Field label="Body"><textarea style={{ ...input, minHeight: 90 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hi {lead.firstName}, …" /></Field>
          <Field label="Variables (comma-separated, ordered)"><input style={input} value={variables} onChange={(e) => setVariables(e.target.value)} placeholder="{lead.firstName}, {campaign.name}" /></Field>
          {error && <div style={{ color: "#991b1b", fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={create} disabled={busy} style={btnPrimary}>{busy ? "Saving…" : "Create"}</button>
            <button onClick={() => { setCreating(false); setError(null); }} style={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "#666", padding: 32 }}>No templates yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {templates.map((t) => (
            <div key={t.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {t.name} <Badge label={t.channel} tone="neutral" /> <Badge label={t.status} tone={STATUS_TONE[t.status] ?? "neutral"} />
                  </div>
                  {t.subject && <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{t.subject}</div>}
                  <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>{t.body}</div>
                  {t.providerTemplateId && <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>SID: {t.providerTemplateId}</div>}
                  {t.rejectionReason && <div style={{ color: "#991b1b", fontSize: 12, marginTop: 4 }}>Rejected: {t.rejectionReason}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
                  {t.channel === "whatsapp" && (t.status === "draft" || t.status === "rejected") && <button onClick={() => submit(t.id)} style={btnGhost}>Submit</button>}
                  {t.channel === "whatsapp" && t.status === "submitted" && <>
                    <button onClick={() => setStatus(t.id, "approved")} style={btnPrimary}>Mark approved</button>
                    <button onClick={() => setStatus(t.id, "rejected")} style={btnGhost}>Reject</button>
                  </>}
                  <button onClick={() => remove(t.id)} style={{ ...btnGhost, color: "#991b1b" }}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 10 }}><label style={lbl}>{label}</label>{children}</div>;
}

const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 16 };
const cardTitle: React.CSSProperties = { fontWeight: 600, marginBottom: 12 };
const lbl: React.CSSProperties = { display: "block", fontSize: 13, color: "#374151", fontWeight: 600, marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" };
const btnPrimary: React.CSSProperties = { background: "#0f766e", color: "#fff", padding: "8px 14px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 13 };
const btnGhost: React.CSSProperties = { background: "#f3f4f6", color: "#374151", padding: "8px 14px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 13 };
