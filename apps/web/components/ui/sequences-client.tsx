"use client";

import { useState } from "react";
import { Badge } from "./badge";
import type { SequenceRow, SequenceStepRow, LeadSegmentRow } from "../../lib/data";

// Drip sequences: an ordered list of timed steps (delay → send on a channel).
// Enroll leads (by saved segment) and the runner advances each enrollment,
// exiting early on reply / opt-out / booking.

type DraftStep = {
  channel: "whatsapp" | "email"; waitMinutes: number;
  whatsappContentSid: string; whatsappTemplateBody: string; emailSubject: string; emailBody: string;
};
const emptyStep = (): DraftStep => ({ channel: "whatsapp", waitMinutes: 0, whatsappContentSid: "", whatsappTemplateBody: "", emailSubject: "", emailBody: "" });

const STATUS_TONE: Record<string, "neutral" | "success" | "warning"> = { draft: "neutral", active: "success", archived: "warning" };
const fmtWait = (m: number) => (m === 0 ? "immediately" : m % 1440 === 0 ? `+${m / 1440}d` : m % 60 === 0 ? `+${m / 60}h` : `+${m}m`);

export function SequencesClient({ initialSequences, segments }: { initialSequences: SequenceRow[]; segments: LeadSegmentRow[] }) {
  const [sequences, setSequences] = useState<SequenceRow[]>(initialSequences);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([emptyStep()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollFor, setEnrollFor] = useState<string | null>(null);
  const [enrollSeg, setEnrollSeg] = useState("");
  const [note, setNote] = useState<string | null>(null);

  function patchStep(i: number, patch: Partial<DraftStep>) {
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  }

  async function create() {
    if (!name.trim()) { setError("Name is required"); return; }
    setBusy(true); setError(null);
    try {
      const payload = {
        name: name.trim(),
        steps: steps.map((s) => ({
          channel: s.channel, waitMinutes: Number(s.waitMinutes) || 0,
          whatsappContentSid: s.whatsappContentSid.trim() || null,
          whatsappTemplateBody: s.whatsappTemplateBody.trim() || null,
          emailSubject: s.emailSubject.trim() || null,
          emailBody: s.emailBody.trim() || null,
        })),
      };
      const res = await fetch("/api/sequences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Create failed"); return; }
      setSequences((s) => [{ ...data.sequence, stepCount: data.sequence.steps.length, enrollmentCount: 0 }, ...s]);
      setName(""); setSteps([emptyStep()]); setCreating(false);
    } finally { setBusy(false); }
  }

  async function setStatus(id: string, status: "active" | "draft") {
    await fetch(`/api/sequences/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    setSequences((s) => s.map((x) => (x.id === id ? { ...x, status } : x)));
  }

  async function remove(id: string) {
    if (!confirm("Delete this sequence and all its enrollments?")) return;
    await fetch(`/api/sequences/${id}`, { method: "DELETE" });
    setSequences((s) => s.filter((x) => x.id !== id));
  }

  async function enroll(id: string) {
    if (!enrollSeg) return;
    setBusy(true); setNote(null);
    try {
      const res = await fetch(`/api/sequences/${id}/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ segmentId: enrollSeg }) });
      const data = await res.json();
      setNote(data.ok ? `Enrolled ${data.enrolled} lead(s) (${data.skipped} already enrolled).` : (data.error ?? "Enroll failed"));
      setSequences((s) => s.map((x) => (x.id === id ? { ...x, enrollmentCount: (x.enrollmentCount ?? 0) + (data.enrolled ?? 0) } : x)));
      setEnrollFor(null); setEnrollSeg("");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Sequences</h1>
          <p style={{ color: "#666", margin: "4px 0 0", fontSize: 14 }}>Automated multi-step drips. Enroll a segment; the runner sends each step on schedule and stops when a lead replies or opts out.</p>
        </div>
        {!creating && <button onClick={() => setCreating(true)} style={btnPrimary}>+ New sequence</button>}
      </div>

      {note && <div style={{ ...card, marginBottom: 12, color: "#166534", background: "#f0fdf4" }}>{note}</div>}

      {creating && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={cardTitle}>New sequence</div>
          <Field label="Name"><input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Post-call nurture" /></Field>
          <div style={{ ...lbl, marginBottom: 8 }}>Steps</div>
          {steps.map((s, i) => (
            <div key={i} style={{ ...card, marginBottom: 10, background: "#fafafa" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>Step {i + 1}</strong>
                {steps.length > 1 && <button onClick={() => setSteps((st) => st.filter((_, idx) => idx !== i))} style={linkBtn}>Remove</button>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Channel">
                  <select style={input} value={s.channel} onChange={(e) => patchStep(i, { channel: e.target.value as "whatsapp" | "email" })}>
                    <option value="whatsapp">WhatsApp</option><option value="email">Email</option>
                  </select>
                </Field>
                <Field label="Wait before sending (minutes)"><input style={input} type="number" min={0} value={s.waitMinutes} onChange={(e) => patchStep(i, { waitMinutes: Number(e.target.value) })} /></Field>
              </div>
              {s.channel === "whatsapp" ? (
                <>
                  <Field label="WhatsApp template SID"><input style={input} value={s.whatsappContentSid} onChange={(e) => patchStep(i, { whatsappContentSid: e.target.value })} placeholder="HX…" /></Field>
                  <Field label="Template body (preview)"><textarea style={{ ...input, minHeight: 54 }} value={s.whatsappTemplateBody} onChange={(e) => patchStep(i, { whatsappTemplateBody: e.target.value })} /></Field>
                </>
              ) : (
                <>
                  <Field label="Email subject"><input style={input} value={s.emailSubject} onChange={(e) => patchStep(i, { emailSubject: e.target.value })} /></Field>
                  <Field label="Email body (HTML)"><textarea style={{ ...input, minHeight: 70 }} value={s.emailBody} onChange={(e) => patchStep(i, { emailBody: e.target.value })} /></Field>
                </>
              )}
            </div>
          ))}
          <button onClick={() => setSteps((s) => [...s, emptyStep()])} style={btnGhost}>+ Add step</button>
          {error && <div style={{ color: "#991b1b", fontSize: 13, margin: "8px 0" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={create} disabled={busy} style={btnPrimary}>{busy ? "Saving…" : "Create sequence"}</button>
            <button onClick={() => { setCreating(false); setError(null); }} style={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {sequences.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "#666", padding: 32 }}>No sequences yet. Create one to automate multi-step follow-ups.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {sequences.map((s) => (
            <div key={s.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name} <Badge label={s.status} tone={STATUS_TONE[s.status] ?? "neutral"} /></div>
                  <div style={{ color: "#6b7280", fontSize: 13 }}>{s.stepCount ?? s.steps?.length ?? 0} steps · {s.enrollmentCount ?? 0} enrolled · exits on {s.exitOn.join(", ") || "—"}</div>
                </div>
                <div style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
                  {s.status === "active"
                    ? <button onClick={() => setStatus(s.id, "draft")} style={btnGhost}>Pause</button>
                    : <button onClick={() => setStatus(s.id, "active")} style={btnPrimary}>Activate</button>}
                  <button onClick={() => { setEnrollFor(enrollFor === s.id ? null : s.id); setEnrollSeg(""); }} style={btnGhost}>Enroll</button>
                  <button onClick={() => remove(s.id)} style={{ ...btnGhost, color: "#991b1b" }}>Delete</button>
                </div>
              </div>
              {enrollFor === s.id && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
                  <select style={{ ...input, width: 240 }} value={enrollSeg} onChange={(e) => setEnrollSeg(e.target.value)}>
                    <option value="">Choose a segment…</option>
                    {segments.map((seg) => <option key={seg.id} value={seg.id}>{seg.name}</option>)}
                  </select>
                  <button onClick={() => enroll(s.id)} disabled={busy || !enrollSeg} style={btnPrimary}>Enroll segment</button>
                  {segments.length === 0 && <span style={{ color: "#9ca3af", fontSize: 13 }}>Create a segment first.</span>}
                </div>
              )}
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
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "#991b1b", cursor: "pointer", fontSize: 13 };
