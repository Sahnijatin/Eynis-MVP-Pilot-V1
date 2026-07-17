"use client";

import { useState } from "react";
import { Button, Card, PageHeader, Field, Input, Select, Textarea, Badge, EmptyState, Modal, useToast, tokens as t } from "../ds";
import { CampaignsNav } from "./campaigns-nav";
import { jsonRequest } from "../../lib/client-request";
import type { SequenceRow, LeadSegmentRow } from "../../lib/data";

// Drip sequences: an ordered list of timed steps (delay → send on a channel).
type DraftStep = {
  channel: "whatsapp" | "email"; waitMinutes: number;
  whatsappContentSid: string; whatsappTemplateBody: string; emailSubject: string; emailBody: string;
};
const emptyStep = (): DraftStep => ({ channel: "whatsapp", waitMinutes: 0, whatsappContentSid: "", whatsappTemplateBody: "", emailSubject: "", emailBody: "" });
const STATUS_TONE: Record<string, "neutral" | "success" | "warning"> = { draft: "neutral", active: "success", archived: "warning" };

export function SequencesClient({ initialSequences, segments }: { initialSequences: SequenceRow[]; segments: LeadSegmentRow[] }) {
  const toast = useToast();
  const [sequences, setSequences] = useState<SequenceRow[]>(initialSequences);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([emptyStep()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollFor, setEnrollFor] = useState<string | null>(null);
  const [enrollSeg, setEnrollSeg] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const patchStep = (i: number, patch: Partial<DraftStep>) => setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));

  async function create() {
    if (!name.trim()) { setError("Name is required"); return; }
    setBusy(true); setError(null);
    try {
      const payload = {
        name: name.trim(),
        steps: steps.map((s) => ({
          channel: s.channel, waitMinutes: Number(s.waitMinutes) || 0,
          whatsappContentSid: s.whatsappContentSid.trim() || null, whatsappTemplateBody: s.whatsappTemplateBody.trim() || null,
          emailSubject: s.emailSubject.trim() || null, emailBody: s.emailBody.trim() || null,
        })),
      };
      const r = await jsonRequest<{ sequence: SequenceRow & { steps: unknown[] } }>("/api/sequences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok || !r.data) { setError(r.error); return; }
      setSequences((s) => [{ ...r.data!.sequence, stepCount: r.data!.sequence.steps.length, enrollmentCount: 0 }, ...s]);
      setName(""); setSteps([emptyStep()]); setCreating(false);
      toast.push("Sequence created", "success");
    } finally { setBusy(false); }
  }

  async function setStatus(id: string, status: "active" | "draft") {
    const r = await jsonRequest(`/api/sequences/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (r.ok) { setSequences((s) => s.map((x) => (x.id === id ? { ...x, status } : x))); toast.push(status === "active" ? "Sequence activated" : "Sequence paused", "success"); }
    else toast.push(r.error, "error");
  }

  async function remove(id: string) {
    const r = await jsonRequest(`/api/sequences/${id}`, { method: "DELETE" });
    setConfirmId(null);
    if (!r.ok) { toast.push(`Delete failed: ${r.error}`, "error"); return; }
    setSequences((s) => s.filter((x) => x.id !== id));
    toast.push("Sequence deleted", "success");
  }

  async function enroll(id: string) {
    if (!enrollSeg) return;
    setBusy(true);
    try {
      const r = await jsonRequest<{ enrolled?: number; skipped?: number }>(`/api/sequences/${id}/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ segmentId: enrollSeg }) });
      if (r.ok && r.data) {
        toast.push(`Enrolled ${r.data.enrolled ?? 0} lead(s) — ${r.data.skipped ?? 0} already enrolled`, "success");
        setSequences((s) => s.map((x) => (x.id === id ? { ...x, enrollmentCount: (x.enrollmentCount ?? 0) + (r.data!.enrolled ?? 0) } : x)));
      } else toast.push(r.error, "error");
      setEnrollFor(null); setEnrollSeg("");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: 28, maxWidth: 960, margin: "0 auto" }}>
      <CampaignsNav active="/sequences" />
      <PageHeader title="Sequences" subtitle="Automated multi-step drips. Enroll a segment; the runner sends each step on schedule and stops when a lead replies or opts out."
        actions={!creating && <Button onClick={() => setCreating(true)}>+ New sequence</Button>} />

      {creating && (
        <Card style={{ marginBottom: 18 }}>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Post-call nurture" /></Field>
          <Field label="Steps">
            <div style={{ display: "grid", gap: 10 }}>
              {steps.map((s, i) => (
                <Card key={i} style={{ background: t.color.surfaceMuted, boxShadow: "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: t.font.sm }}>Step {i + 1}</strong>
                    {steps.length > 1 && <Button size="sm" variant="danger" onClick={() => setSteps((st) => st.filter((_, idx) => idx !== i))}>Remove</Button>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <Field label="Channel"><Select value={s.channel} onChange={(e) => patchStep(i, { channel: e.target.value as "whatsapp" | "email" })}><option value="whatsapp">WhatsApp</option><option value="email">Email</option></Select></Field>
                    <Field label="Wait before sending (min)"><Input type="number" min={0} value={s.waitMinutes} onChange={(e) => patchStep(i, { waitMinutes: Number(e.target.value) })} /></Field>
                  </div>
                  {s.channel === "whatsapp" ? (
                    <>
                      <Field label="WhatsApp template SID" hint="Must be an approved template to activate."><Input value={s.whatsappContentSid} onChange={(e) => patchStep(i, { whatsappContentSid: e.target.value })} placeholder="HX…" /></Field>
                      <Field label="Template body (preview)"><Textarea value={s.whatsappTemplateBody} onChange={(e) => patchStep(i, { whatsappTemplateBody: e.target.value })} style={{ minHeight: 54 }} /></Field>
                    </>
                  ) : (
                    <>
                      <Field label="Email subject"><Input value={s.emailSubject} onChange={(e) => patchStep(i, { emailSubject: e.target.value })} /></Field>
                      <Field label="Email body (HTML)"><Textarea value={s.emailBody} onChange={(e) => patchStep(i, { emailBody: e.target.value })} style={{ minHeight: 70 }} /></Field>
                    </>
                  )}
                </Card>
              ))}
            </div>
            <div style={{ marginTop: 10 }}><Button variant="secondary" size="sm" onClick={() => setSteps((s) => [...s, emptyStep()])}>+ Add step</Button></div>
          </Field>
          {error && <div style={{ color: t.color.danger, fontSize: t.font.sm, margin: "8px 0" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={create} disabled={busy}>{busy ? "Saving…" : "Create sequence"}</Button>
            <Button variant="ghost" onClick={() => { setCreating(false); setError(null); }}>Cancel</Button>
          </div>
        </Card>
      )}

      {sequences.length === 0 ? (
        <EmptyState icon="⚡" title="No sequences yet" description="Create one to automate multi-step follow-ups across WhatsApp and email." action={<Button onClick={() => setCreating(true)}>+ New sequence</Button>} />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {sequences.map((s) => (
            <Card key={s.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, color: t.color.text }}>{s.name}</span>
                    <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>{s.status}</Badge>
                  </div>
                  <div style={{ color: t.color.textMuted, fontSize: t.font.sm, marginTop: 4 }}>{s.stepCount ?? s.steps?.length ?? 0} steps · {s.enrollmentCount ?? 0} enrolled · exits on {s.exitOn.join(", ") || "—"}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {s.status === "active" ? <Button size="sm" variant="secondary" onClick={() => setStatus(s.id, "draft")}>Pause</Button> : <Button size="sm" onClick={() => setStatus(s.id, "active")}>Activate</Button>}
                  <Button size="sm" variant="secondary" onClick={() => { setEnrollFor(enrollFor === s.id ? null : s.id); setEnrollSeg(""); }}>Enroll</Button>
                  <Button size="sm" variant="danger" onClick={() => setConfirmId(s.id)}>Delete</Button>
                </div>
              </div>
              {enrollFor === s.id && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${t.color.border}` }}>
                  <Select style={{ width: 260 }} value={enrollSeg} onChange={(e) => setEnrollSeg(e.target.value)}>
                    <option value="">Choose a segment…</option>
                    {segments.map((seg) => <option key={seg.id} value={seg.id}>{seg.name}</option>)}
                  </Select>
                  <Button size="sm" onClick={() => enroll(s.id)} disabled={busy || !enrollSeg}>Enroll segment</Button>
                  {segments.length === 0 && <span style={{ color: t.color.textFaint, fontSize: t.font.sm }}>Create a segment first.</span>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {confirmId && (
        <Modal title="Delete sequence?" onClose={() => setConfirmId(null)}
          footer={<><Button variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button><Button variant="danger" onClick={() => remove(confirmId)}>Delete</Button></>}>
          <p style={{ margin: 0, color: t.color.textMuted, fontSize: t.font.base }}>This deletes the sequence and all its enrollments.</p>
        </Modal>
      )}
    </div>
  );
}
