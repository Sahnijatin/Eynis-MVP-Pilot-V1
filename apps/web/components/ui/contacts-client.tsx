"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, PageHeader, Field, Input, Select, Textarea, Badge, EmptyState, Modal, Spinner, useToast, tokens as t } from "../ds";
import type { ContactRow, CompanyRow, TimelineItem } from "../../lib/data";

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
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => setContacts(initialContacts), [initialContacts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (lifecycleFilter && c.lifecycleStage !== lifecycleFilter) return false;
      if (!q) return true;
      return c.fullName.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || c.phoneE164.includes(q);
    });
  }, [contacts, search, lifecycleFilter]);

  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="Contacts"
        subtitle="Your single customer view — every person, their company, and their deals"
        actions={<Button onClick={() => setCreating(true)}>+ New contact</Button>}
      />

      <Card style={{ padding: 12, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Input placeholder="Search name, email or phone…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
        <Select value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">All lifecycle stages</option>
          {LIFECYCLE.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <span style={{ marginLeft: "auto", fontSize: t.font.sm, color: t.color.textMuted }}>{filtered.length} of {contacts.length}</span>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState title="No contacts yet" description="Add a contact, or import leads via Campaigns — they roll up here automatically." icon="👥" action={<Button onClick={() => setCreating(true)}>+ New contact</Button>} />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: t.font.sm }}>
            <thead>
              <tr style={{ background: t.color.surfaceMuted, textAlign: "left", color: t.color.textMuted }}>
                <th style={th}>Name</th><th style={th}>Company</th><th style={th}>Lifecycle</th><th style={th}>Owner</th><th style={th}>Deals</th><th style={th}>Tags</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: "pointer", borderTop: `1px solid ${t.color.border}` }}>
                  <td style={td}>
                    <div style={{ fontWeight: 600, color: t.color.text }}>{c.fullName}</div>
                    <div style={{ fontSize: t.font.xs, color: t.color.textFaint }}>{c.email || c.phoneE164 || "—"}</div>
                  </td>
                  <td style={td}>{c.companyName || <span style={{ color: t.color.textFaint }}>—</span>}</td>
                  <td style={td}><Badge tone={lifecycleTone(c.lifecycleStage)}>{c.lifecycleStage}</Badge></td>
                  <td style={td}>{c.ownerName || <span style={{ color: t.color.textFaint }}>Unassigned</span>}</td>
                  <td style={td}>{c.dealCount ?? 0}</td>
                  <td style={td}>{c.tags.slice(0, 3).map((tg) => <Badge key={tg} tone="neutral" style={{ marginRight: 4 }}>{tg}</Badge>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && (
        <CreateContactModal companies={companies} owners={owners} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); router.refresh(); }} />
      )}
      {openId && (
        <ContactDetailModal id={openId} companies={companies} owners={owners} onClose={() => setOpenId(null)} onChanged={() => { setOpenId(null); router.refresh(); }} fmtINR={fmtINR} />
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, fontSize: 12 };
const td: React.CSSProperties = { padding: "10px 14px", verticalAlign: "top" };

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
  const [score, setScore] = useState<{ score: number; tier: string; reasons: string[]; source: string } | null>(null);
  const [scoring, setScoring] = useState(false);
  const [actType, setActType] = useState<"note" | "task">("note");
  const [actTitle, setActTitle] = useState("");
  const [actDue, setActDue] = useState("");

  async function loadTimeline() {
    const res = await fetch(`/api/contacts/${id}/timeline`);
    const d = await res.json();
    if (d.ok) setTimeline(d.items as TimelineItem[]);
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
            <Button variant="secondary" onClick={runScore} disabled={scoring}>{scoring ? <Spinner size={14} /> : "✨ AI score"}</Button>
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
