"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader, Field, Input, Select, Textarea, Badge, Modal, Spinner, useToast, tokens as t } from "../ds";
import { DataGrid, type GridColumn } from "./data-grid";
import { CrmTabs } from "./crm-tabs";
import { CsvImportModal } from "./csv-import-modal";
import ResearchButton from "./research-button";
import type { ContactRow, CompanyRow, TimelineItem } from "../../lib/data";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

const KIND_ICON: Record<string, string> = {
  note: "📝", task: "✅", meeting: "📅", call: "📞", whatsapp: "💬", email: "✉️",
  message: "✉️", service_request: "🛎️", stage_change: "↗️", ai_score: "✨", ai_suggestion: "🤖", system: "⚙️",
};

const LIFECYCLE = ["subscriber", "lead", "mql", "sql", "opportunity", "customer"];
const LEAD_STATUS = ["new", "attempting", "connected", "qualified", "disqualified"];

function lifecycleTone(stage: string): "neutral" | "accent" | "success" | "warning" {
  if (stage === "customer") return "success";
  if (stage === "opportunity" || stage === "sql") return "accent";
  if (stage === "mql") return "warning";
  return "neutral";
}
function fmtINR(n: number): string {
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n); }
  catch { return "₹" + Math.round(n).toLocaleString("en-IN"); }
}

type DealLite = { id: string; title: string; value: number | null; currency: string; stageName: string | null; status: string };

export function ContactsClient({
  initialContacts, companies, owners,
}: {
  initialContacts: ContactRow[];
  companies: CompanyRow[];
  owners: Array<{ id: string; fullName: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => setContacts(initialContacts), [initialContacts]);

  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));
  const ownerOptions = owners.map((o) => ({ value: o.id, label: o.fullName }));

  // Inline edits map grid column keys to the contact PATCH payload fields.
  async function editCell(row: ContactRow, key: string, value: string) {
    const field = key === "company" ? "companyId" : key === "owner" ? "ownerId" : key === "lifecycle" ? "lifecycleStage" : key;
    const res = await fetch(`/api/contacts/${row.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: value || null }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Update failed");
    toast.push("Contact updated", "success");
    router.refresh();
  }

  async function deleteRows(rows: ContactRow[]) {
    for (const r of rows) {
      const res = await fetch(`/api/contacts/${r.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Delete failed");
    }
    toast.push(`Deleted ${rows.length} contact(s)`, "success");
    router.refresh();
  }

  async function importRows(records: Record<string, string>[]) {
    let created = 0, failed = 0; const errors: string[] = [];
    for (const rec of records) {
      if (!rec.fullName?.trim()) { failed++; continue; }
      try {
        const res = await fetch("/api/contacts", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ fullName: rec.fullName.trim(), email: rec.email || undefined, phoneE164: rec.phoneE164 || undefined, lifecycleStage: rec.lifecycleStage || undefined }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) { failed++; if (data.error) errors.push(data.error); } else created++;
      } catch { failed++; }
    }
    router.refresh();
    return { created, failed, errors };
  }

  const columns: GridColumn<ContactRow>[] = [
    { key: "name", header: "Name", accessor: (c) => c.fullName, width: 180, render: (c) => (
        <button onClick={() => setOpenId(c.id)} style={{ background: "none", border: "none", padding: 0, color: t.color.accent, fontWeight: 600, cursor: "pointer", fontSize: t.font.sm }}>{c.fullName}</button>
      ) },
    { key: "email", header: "Email", accessor: (c) => c.email ?? "" },
    { key: "phone", header: "Phone", accessor: (c) => c.phoneE164 ?? "", defaultHidden: true },
    { key: "company", header: "Company", type: "select", accessor: (c) => c.companyName ?? "", editAccessor: (c) => c.companyId ?? "", editable: true, options: companyOptions },
    { key: "lifecycle", header: "Lifecycle", type: "select", accessor: (c) => c.lifecycleStage, editable: true, options: LIFECYCLE.map((s) => ({ value: s, label: s })), render: (c) => <Badge tone={lifecycleTone(c.lifecycleStage)}>{c.lifecycleStage}</Badge> },
    { key: "leadStatus", header: "Lead status", type: "select", accessor: (c) => c.leadStatus ?? "", editable: true, options: LEAD_STATUS.map((s) => ({ value: s, label: s })) },
    { key: "owner", header: "Owner", type: "select", accessor: (c) => c.ownerName ?? "", editAccessor: (c) => c.ownerId ?? "", editable: true, options: ownerOptions },
    { key: "leadScore", header: "Score", type: "number", accessor: (c) => c.leadScore ?? "", align: "right", filterable: false, defaultHidden: true },
    { key: "deals", header: "Deals", type: "number", accessor: (c) => c.dealCount ?? 0, align: "right", filterable: false },
    { key: "tags", header: "Tags", accessor: (c) => (c.tags ?? []).join(", ") },
    { key: "createdAt", header: "Created", type: "date", accessor: (c) => c.createdAt, render: (c) => fmtDate(c.createdAt), defaultHidden: true },
  ];

  return (
    <div style={{ padding: 24 }}>
      <CrmTabs />
      <PageHeader
        title="Contacts"
        subtitle="Your single customer view — every person, their company, and their deals"
        actions={<>
          <Button variant="secondary" onClick={() => setImporting(true)}>Import CSV</Button>
          <Button onClick={() => setCreating(true)}>+ New contact</Button>
        </>}
      />

      <DataGrid<ContactRow>
        rows={contacts}
        columns={columns}
        getId={(c) => c.id}
        storageKey="contacts"
        exportFilename="contacts"
        onEditCell={editCell}
        onDeleteRows={deleteRows}
        onRowOpen={(c) => setOpenId(c.id)}
        searchPlaceholder="Search name, email or phone…"
        emptyTitle="No contacts yet"
        emptyDescription="Add a contact, import a CSV, or capture leads via Campaigns — they roll up here automatically."
      />

      {creating && (
        <CreateContactModal companies={companies} owners={owners} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); router.refresh(); }} />
      )}
      {importing && <CsvImportModal title="Import contacts" onClose={() => setImporting(false)} onImport={importRows}
        fields={[{ key: "fullName", label: "Full name", required: true }, { key: "email", label: "Email" }, { key: "phoneE164", label: "Phone" }, { key: "lifecycleStage", label: "Lifecycle stage" }]} />}
      {openId && (
        <ContactDetailModal id={openId} companies={companies} owners={owners} onClose={() => setOpenId(null)} onChanged={() => { setOpenId(null); router.refresh(); }} fmtINR={fmtINR} />
      )}
    </div>
  );
}

function CreateContactModal({ companies, owners, onClose, onCreated }: { companies: CompanyRow[]; owners: Array<{ id: string; fullName: string }>; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [lifecycleStage, setLifecycle] = useState("lead");
  const [companyId, setCompanyId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!fullName.trim()) { setError("Name is required"); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim(), email: email || undefined, phoneE164: phone || undefined, lifecycleStage, companyId: companyId || undefined, ownerId: ownerId || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not create contact");
      toast.push("Contact created", "success");
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create contact"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="New contact" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? <Spinner size={14} /> : "Create"}</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Full name"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" /></Field>
        <Field label="Lifecycle stage"><Select value={lifecycleStage} onChange={(e) => setLifecycle(e.target.value)}>{LIFECYCLE.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
        {companies.length > 0 && <Field label="Company"><Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}><option value="">None</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        {owners.length > 0 && <Field label="Owner"><Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.fullName}</option>)}</Select></Field>}
        {error && <div style={{ color: t.color.danger, fontSize: t.font.sm }}>{error}</div>}
      </div>
    </Modal>
  );
}

function ContactDetailModal({ id, companies, owners, onClose, onChanged, fmtINR }: { id: string; companies: CompanyRow[]; owners: Array<{ id: string; fullName: string }>; onClose: () => void; onChanged: () => void; fmtINR: (n: number) => string }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [contact, setContact] = useState<ContactRow | null>(null);
  const [deals, setDeals] = useState<DealLite[]>([]);
  const [busy, setBusy] = useState(false);
  // editable fields
  const [lifecycleStage, setLifecycle] = useState("lead");
  const [leadStatus, setLeadStatus] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [score, setScore] = useState<{ score: number; tier: string; reasons: string[]; source: string } | null>(null);
  const [scoring, setScoring] = useState(false);
  const [actType, setActType] = useState<"note" | "task">("note");
  const [actTitle, setActTitle] = useState("");
  const [actDue, setActDue] = useState("");

  async function loadTimeline() {
    try {
      const res = await fetch(`/api/contacts/${id}/timeline`);
      const d = await res.json();
      if (res.ok && d.ok) { setTimeline(d.items as TimelineItem[]); setTimelineError(null); }
      else { setTimeline([]); setTimelineError("Couldn't load the timeline."); }
    } catch {
      setTimeline([]);
      setTimelineError("Couldn't load the timeline.");
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [res, tlRes] = await Promise.all([fetch(`/api/contacts/${id}`), fetch(`/api/contacts/${id}/timeline`)]);
        const data = await res.json();
        const tl = await tlRes.json();
        if (!active) return;
        if (data.ok) {
          const c: ContactRow = data.contact;
          setContact(c);
          setDeals(data.deals ?? []);
          setLifecycle(c.lifecycleStage);
          setLeadStatus(c.leadStatus ?? "");
          setCompanyId(c.companyId ?? "");
          setOwnerId(c.ownerId ?? "");
          setTags(c.tags.join(", "));
          setNotes(c.notes ?? "");
          if (c.leadScore != null) setScore({ score: c.leadScore, tier: "", reasons: [], source: "" });
        }
        if (tl.ok) setTimeline(tl.items as TimelineItem[]);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [id]);

  async function runScore() {
    setScoring(true);
    try {
      const res = await fetch(`/api/contacts/${id}/score`, { method: "POST" });
      const d = await res.json();
      if (d.ok) { setScore(d.score); toast.push(`AI score: ${d.score.score} (${d.score.tier})`, "success"); loadTimeline(); }
      else throw new Error(d.error || "Scoring failed");
    } catch (e) { toast.push(e instanceof Error ? e.message : "Scoring failed", "error"); }
    finally { setScoring(false); }
  }

  async function addActivity() {
    if (!actTitle.trim()) return;
    try {
      const res = await fetch(`/api/contacts/${id}/activities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: actType, title: actTitle.trim(), dueAt: actDue || undefined }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "Could not log");
      setActTitle(""); setActDue("");
      toast.push(actType === "task" ? "Task added" : "Note logged", "success");
      loadTimeline();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Could not log", "error"); }
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ lifecycleStage, leadStatus: leadStatus || null, companyId: companyId || null, ownerId: ownerId || null, tags: tags.split(",").map((s) => s.trim()).filter(Boolean), notes }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed");
      toast.push("Contact updated", "success");
      onChanged();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Save failed", "error"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm("Delete this contact? Its deals will be unlinked.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Delete failed");
      toast.push("Contact deleted", "success");
      onChanged();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Delete failed", "error"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={contact?.fullName ?? "Contact"} onClose={onClose} width={560}
      footer={<><Button variant="secondary" onClick={remove} disabled={busy} style={{ marginRight: "auto", color: t.color.danger }}>Delete</Button><Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner size={14} /> : "Save"}</Button></>}>
      {loading ? <div style={{ textAlign: "center", padding: 24 }}><Spinner /></div> : !contact ? <div>Not found.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: t.font.sm, color: t.color.textMuted }}>{contact.email || "—"} · {contact.phoneE164 || "no phone"} · source: {contact.source || "—"}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <ResearchButton subjectType="contact" subjectId={id} subjectLabel={contact.fullName} prefill={{ name: contact.fullName, email: contact.email ?? "" }} />
              <Button variant="secondary" onClick={runScore} disabled={scoring}>{scoring ? <Spinner size={14} /> : "✨ AI score"}</Button>
            </div>
          </div>
          {score && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", background: t.color.accentSoft, borderRadius: t.radius.md }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: t.color.accent }}>{score.score}</div>
              <div>
                {score.tier && <Badge tone={score.score >= 80 ? "success" : score.score >= 55 ? "accent" : "neutral"}>{score.tier}</Badge>}
                {score.reasons.length > 0 && <div style={{ fontSize: t.font.xs, color: t.color.textMuted, marginTop: 3 }}>{score.reasons.slice(0, 3).join(" · ")}</div>}
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Lifecycle stage"><Select value={lifecycleStage} onChange={(e) => setLifecycle(e.target.value)}>{LIFECYCLE.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Field label="Lead status"><Select value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)}><option value="">—</option>{LEAD_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Field label="Company"><Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}><option value="">None</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Owner"><Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.fullName}</option>)}</Select></Field>
          </div>
          <Field label="Tags" hint="comma-separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
          <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></Field>
          <div>
            <div style={{ fontSize: t.font.xs, fontWeight: 600, textTransform: "uppercase", color: t.color.textMuted, marginBottom: 6 }}>Deals ({deals.length})</div>
            {deals.length === 0 ? <div style={{ fontSize: t.font.sm, color: t.color.textFaint }}>No deals linked yet.</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {deals.map((d) => (
                  <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", border: `1px solid ${t.color.border}`, borderRadius: t.radius.md }}>
                    <span>{d.title} <Badge tone="neutral">{d.stageName}</Badge></span>
                    <span style={{ fontWeight: 600 }}>{d.value != null ? fmtINR(d.value) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add note / task */}
          <div>
            <div style={{ fontSize: t.font.xs, fontWeight: 600, textTransform: "uppercase", color: t.color.textMuted, marginBottom: 6 }}>Log activity</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <Select value={actType} onChange={(e) => setActType(e.target.value as "note" | "task")} style={{ width: 100 }}>
                <option value="note">Note</option>
                <option value="task">Task</option>
              </Select>
              <Input value={actTitle} onChange={(e) => setActTitle(e.target.value)} placeholder={actType === "task" ? "Follow up about…" : "What happened…"} style={{ flex: 1 }} />
              {actType === "task" && <Input type="date" value={actDue} onChange={(e) => setActDue(e.target.value)} style={{ width: 140 }} />}
              <Button onClick={addActivity} disabled={!actTitle.trim()}>Add</Button>
            </div>
          </div>

          {/* Timeline */}
          <div>
            <div style={{ fontSize: t.font.xs, fontWeight: 600, textTransform: "uppercase", color: t.color.textMuted, marginBottom: 6 }}>Timeline ({timeline.length})</div>
            {timelineError && <div style={{ fontSize: t.font.sm, color: t.color.danger, marginBottom: 6 }}>{timelineError}</div>}
            {timeline.length === 0 ? <div style={{ fontSize: t.font.sm, color: t.color.textFaint }}>No activity yet.</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflowY: "auto" }}>
                {timeline.map((i) => (
                  <div key={i.kind + i.id} style={{ display: "flex", gap: 8, fontSize: t.font.sm }}>
                    <span style={{ fontSize: 15 }}>{KIND_ICON[i.kind] ?? "•"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: t.color.text }}>
                        {i.title}
                        {i.sentiment && <Badge tone={i.sentiment === "positive" ? "success" : i.sentiment === "negative" ? "danger" : "neutral"} style={{ marginLeft: 6 }}>{i.sentiment}</Badge>}
                        {i.status === "open" && <Badge tone="warning" style={{ marginLeft: 6 }}>open</Badge>}
                        {i.status === "done" && <Badge tone="success" style={{ marginLeft: 6 }}>done</Badge>}
                      </div>
                      {i.body && <div style={{ color: t.color.textMuted, fontSize: t.font.xs }}>{i.body.length > 160 ? i.body.slice(0, 160) + "…" : i.body}</div>}
                      <div style={{ color: t.color.textFaint, fontSize: 11 }}>{new Date(i.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
