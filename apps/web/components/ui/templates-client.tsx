"use client";

import { useState } from "react";
import {
  Button, Card, PageHeader, Field, Input, Select, Textarea, Badge,
  EmptyState, Modal, useToast, tokens as t,
} from "../ds";
import { CampaignsNav } from "./campaigns-nav";
import type { MessageTemplateRow } from "../../lib/data";

// Message template library: author reusable WhatsApp/email templates and track
// the WhatsApp approval lifecycle (draft → submitted → approved/rejected).

const STATUS_TONE: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  draft: "neutral", submitted: "warning", approved: "success", rejected: "danger",
};

export function TemplatesClient({ initialTemplates }: { initialTemplates: MessageTemplateRow[] }) {
  const toast = useToast();
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
  // approve/reject modal
  const [modal, setModal] = useState<{ id: string; action: "approved" | "rejected" } | null>(null);
  const [modalValue, setModalValue] = useState("");

  const replace = (tpl: MessageTemplateRow) => setTemplates((ts) => ts.map((x) => (x.id === tpl.id ? tpl : x)));

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
      toast.push("Template created", "success");
    } finally { setBusy(false); }
  }

  async function submit(id: string) {
    const res = await fetch(`/api/templates/${id}/submit`, { method: "POST" });
    const data = await res.json();
    if (data.ok) { replace(data.template); toast.push("Submitted for approval", "success"); }
    else toast.push(data.error ?? "Failed", "error");
  }

  async function confirmModal() {
    if (!modal) return;
    const extra = modal.action === "approved" ? { providerTemplateId: modalValue.trim() } : { rejectionReason: modalValue.trim() };
    const res = await fetch(`/api/templates/${modal.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: modal.action, ...extra }) });
    const data = await res.json();
    if (data.ok) { replace(data.template); toast.push(modal.action === "approved" ? "Template approved" : "Template rejected", "success"); setModal(null); setModalValue(""); }
    else toast.push(data.error ?? "Failed", "error");
  }

  async function remove(id: string) {
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    setTemplates((ts) => ts.filter((x) => x.id !== id));
    toast.push("Template deleted");
  }

  return (
    <div style={{ padding: 28, maxWidth: 960, margin: "0 auto" }}>
      <CampaignsNav active="/templates" />
      <PageHeader
        title="Message templates"
        subtitle="Reusable WhatsApp & email content. WhatsApp templates need Meta/Twilio approval — track that here and record the approved Content SID."
        actions={!creating && <Button onClick={() => setCreating(true)}>+ New template</Button>}
      />

      {creating && (
        <Card style={{ marginBottom: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Welcome message" /></Field>
            <Field label="Channel"><Select value={channel} onChange={(e) => setChannel(e.target.value as "whatsapp" | "email")}><option value="whatsapp">WhatsApp</option><option value="email">Email</option></Select></Field>
            <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="marketing">Marketing</option><option value="utility">Utility</option><option value="authentication">Authentication</option></Select></Field>
          </div>
          {channel === "email" && <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
          <Field label="Body"><Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hi {lead.firstName}, …" style={{ minHeight: 90 }} /></Field>
          <Field label="Variables (comma-separated, ordered)" hint="Map to {{1}}, {{2}}… in the approved template."><Input value={variables} onChange={(e) => setVariables(e.target.value)} placeholder="{lead.firstName}, {campaign.name}" /></Field>
          {error && <div style={{ color: t.color.danger, fontSize: t.font.sm, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={create} disabled={busy}>{busy ? "Saving…" : "Create"}</Button>
            <Button variant="ghost" onClick={() => { setCreating(false); setError(null); }}>Cancel</Button>
          </div>
        </Card>
      )}

      {templates.length === 0 ? (
        <EmptyState icon="📝" title="No templates yet" description="Author a WhatsApp or email template to reuse across campaigns and sequences." action={<Button onClick={() => setCreating(true)}>+ New template</Button>} />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {templates.map((tpl) => (
            <Card key={tpl.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, color: t.color.text }}>{tpl.name}</span>
                    <Badge tone="accent">{tpl.channel}</Badge>
                    <Badge tone={STATUS_TONE[tpl.status] ?? "neutral"}>{tpl.status}</Badge>
                    <Badge>{tpl.category}</Badge>
                  </div>
                  {tpl.subject && <div style={{ fontWeight: 600, fontSize: t.font.sm, marginTop: 6 }}>{tpl.subject}</div>}
                  <div style={{ color: t.color.textMuted, fontSize: t.font.sm, marginTop: 4, whiteSpace: "pre-wrap" }}>{tpl.body}</div>
                  {tpl.providerTemplateId && <div style={{ color: t.color.textFaint, fontSize: t.font.xs, marginTop: 6 }}>Content SID: {tpl.providerTemplateId}</div>}
                  {tpl.rejectionReason && <div style={{ color: t.color.danger, fontSize: t.font.xs, marginTop: 6 }}>Rejected: {tpl.rejectionReason}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {tpl.channel === "whatsapp" && (tpl.status === "draft" || tpl.status === "rejected") && <Button size="sm" variant="secondary" onClick={() => submit(tpl.id)}>Submit</Button>}
                  {tpl.channel === "whatsapp" && tpl.status === "submitted" && <>
                    <Button size="sm" onClick={() => { setModal({ id: tpl.id, action: "approved" }); setModalValue(""); }}>Mark approved</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setModal({ id: tpl.id, action: "rejected" }); setModalValue(""); }}>Reject</Button>
                  </>}
                  <Button size="sm" variant="danger" onClick={() => remove(tpl.id)}>Delete</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {modal && (
        <Modal
          title={modal.action === "approved" ? "Approve template" : "Reject template"}
          onClose={() => setModal(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button variant={modal.action === "rejected" ? "danger" : "primary"} onClick={confirmModal} disabled={modal.action === "approved" && !modalValue.trim()}>
              {modal.action === "approved" ? "Approve" : "Reject"}
            </Button>
          </>}
        >
          {modal.action === "approved" ? (
            <Field label="Approved Content SID / provider template id" hint="From your Twilio/Meta console once the template is approved.">
              <Input autoFocus value={modalValue} onChange={(e) => setModalValue(e.target.value)} placeholder="HX…" />
            </Field>
          ) : (
            <Field label="Rejection reason (optional)">
              <Input autoFocus value={modalValue} onChange={(e) => setModalValue(e.target.value)} placeholder="e.g. policy violation" />
            </Field>
          )}
        </Modal>
      )}
    </div>
  );
}
