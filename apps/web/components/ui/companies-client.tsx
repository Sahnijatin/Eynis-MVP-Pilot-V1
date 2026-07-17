"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, PageHeader, Field, Input, Select, Textarea, Badge, Modal, Spinner, useToast, tokens as t } from "../ds";
import { DataGrid, type GridColumn } from "./data-grid";
import { CrmTabs } from "./crm-tabs";
import { CsvImportModal } from "./csv-import-modal";
import ResearchButton from "./research-button";
import { jsonRequest } from "../../lib/client-request";
import type { CompanyRow, ContactRow } from "../../lib/data";

const SIZES = ["1-10", "11-50", "51-200", "200+"];
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
function fmtINR(n: number): string {
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n); }
  catch { return "₹" + Math.round(n).toLocaleString("en-IN"); }
}

type DealLite = { id: string; title: string; value: number | null; stageName: string | null; status: string };

export function CompaniesClient({ initialCompanies, owners }: { initialCompanies: CompanyRow[]; owners: Array<{ id: string; fullName: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [companies, setCompanies] = useState<CompanyRow[]>(initialCompanies);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => setCompanies(initialCompanies), [initialCompanies]);

  const ownerOptions = owners.map((o) => ({ value: o.id, label: o.fullName }));

  // Maps a grid column key to the PATCH payload field.
  async function editCell(row: CompanyRow, key: string, value: string) {
    const field = key === "owner" ? "ownerId" : key;
    const res = await fetch(`/api/companies/${row.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ [field]: value || null }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Update failed");
    toast.push("Company updated", "success");
    router.refresh();
  }

  async function deleteRows(rows: CompanyRow[]) {
    // Best-effort: keep going past a failed row and ALWAYS refresh — aborting
    // mid-batch left already-deleted rows visible (and selected) in the grid.
    let failed = 0;
    for (const r of rows) {
      const res = await jsonRequest(`/api/companies/${r.id}`, { method: "DELETE" });
      if (!res.ok) failed++;
    }
    router.refresh();
    if (failed > 0) throw new Error(`${failed} of ${rows.length} could not be deleted`);
    toast.push(`Deleted ${rows.length} company(ies)`, "success");
  }

  async function importRows(records: Record<string, string>[]) {
    let created = 0, failed = 0; const errors: string[] = [];
    for (const rec of records) {
      if (!rec.name?.trim()) { failed++; continue; }
      try {
        const res = await fetch("/api/companies", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: rec.name.trim(), domain: rec.domain || undefined, industry: rec.industry || undefined, size: rec.size || undefined }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) { failed++; if (data.error) errors.push(data.error); } else created++;
      } catch { failed++; }
    }
    router.refresh();
    return { created, failed, errors };
  }

  const columns: GridColumn<CompanyRow>[] = [
    { key: "name", header: "Name", accessor: (c) => c.name, render: (c) => (
        <button onClick={() => setOpenId(c.id)} style={{ background: "none", border: "none", padding: 0, color: t.color.accent, fontWeight: 600, cursor: "pointer", fontSize: t.font.sm }}>{c.name}</button>
      ), width: 200 },
    { key: "domain", header: "Domain", accessor: (c) => c.domain ?? "", editable: true },
    { key: "industry", header: "Industry", accessor: (c) => c.industry ?? "", editable: true },
    { key: "size", header: "Size", type: "select", accessor: (c) => c.size ?? "", editable: true, options: SIZES.map((s) => ({ value: s, label: s })) },
    { key: "owner", header: "Owner", type: "select", accessor: (c) => c.ownerName ?? "", editAccessor: (c) => c.ownerId ?? "", editable: true, options: ownerOptions },
    { key: "contacts", header: "Contacts", type: "number", accessor: (c) => c.contactCount ?? 0, align: "right", editable: false, filterable: false },
    { key: "deals", header: "Deals", type: "number", accessor: (c) => c.dealCount ?? 0, align: "right", editable: false, filterable: false },
    { key: "tags", header: "Tags", accessor: (c) => (c.tags ?? []).join(", "), editable: false },
    { key: "createdAt", header: "Created", type: "date", accessor: (c) => c.createdAt, render: (c) => fmtDate(c.createdAt), editable: false, defaultHidden: true },
  ];

  return (
    <div style={{ padding: 24 }}>
      <CrmTabs />
      <PageHeader title="Companies" subtitle="Accounts your contacts and deals roll up to"
        actions={<>
          <Button variant="secondary" onClick={() => setImporting(true)}>Import CSV</Button>
          <Button onClick={() => setCreating(true)}>+ New company</Button>
        </>} />

      <DataGrid<CompanyRow>
        rows={companies}
        columns={columns}
        getId={(c) => c.id}
        storageKey="companies"
        exportFilename="companies"
        onEditCell={editCell}
        onDeleteRows={deleteRows}
        onRowOpen={(c) => setOpenId(c.id)}
        searchPlaceholder="Search companies…"
        emptyTitle="No companies yet"
        emptyDescription="Create a company, or import a CSV, to group contacts and deals into accounts."
      />

      {creating && <CreateCompanyModal owners={owners} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); router.refresh(); }} />}
      {importing && <CsvImportModal title="Import companies" onClose={() => setImporting(false)} onImport={importRows}
        fields={[{ key: "name", label: "Name", required: true }, { key: "domain", label: "Domain" }, { key: "industry", label: "Industry" }, { key: "size", label: "Size" }]} />}
      {openId && <CompanyDetailModal id={openId} owners={owners} onClose={() => setOpenId(null)} onChanged={() => { setOpenId(null); router.refresh(); }} />}
    </div>
  );
}

function CreateCompanyModal({ owners, onClose, onCreated }: { owners: Array<{ id: string; fullName: string }>; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setError("Name is required"); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/companies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), domain: domain || undefined, industry: industry || undefined, size: size || undefined, ownerId: ownerId || undefined }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not create company");
      toast.push("Company created", "success");
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create company"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="New company" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? <Spinner size={14} /> : "Create"}</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Domain"><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" /></Field>
        <Field label="Industry"><Input value={industry} onChange={(e) => setIndustry(e.target.value)} /></Field>
        <Field label="Size"><Select value={size} onChange={(e) => setSize(e.target.value)}><option value="">—</option>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
        {owners.length > 0 && <Field label="Owner"><Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.fullName}</option>)}</Select></Field>}
        {error && <div style={{ color: t.color.danger, fontSize: t.font.sm }}>{error}</div>}
      </div>
    </Modal>
  );
}

function CompanyDetailModal({ id, owners, onClose, onChanged }: { id: string; owners: Array<{ id: string; fullName: string }>; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanyRow | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [deals, setDeals] = useState<DealLite[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/companies/${id}`);
        const data = await res.json();
        if (!active) return;
        if (data.ok) {
          const c: CompanyRow = data.company;
          setCompany(c); setContacts(data.contacts ?? []); setDeals(data.deals ?? []);
          setName(c.name); setDomain(c.domain ?? ""); setIndustry(c.industry ?? ""); setOwnerId(c.ownerId ?? ""); setNotes(c.notes ?? "");
        }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [id]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, domain: domain || null, industry: industry || null, ownerId: ownerId || null, notes }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed");
      toast.push("Company updated", "success"); onChanged();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Save failed", "error"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm("Delete this company? Contacts and deals will be unlinked.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Delete failed");
      toast.push("Company deleted", "success"); onChanged();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Delete failed", "error"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={company?.name ?? "Company"} onClose={onClose} width={560}
      footer={<><Button variant="secondary" onClick={remove} disabled={busy} style={{ marginRight: "auto", color: t.color.danger }}>Delete</Button><Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button><Button onClick={save} disabled={busy}>{busy ? <Spinner size={14} /> : "Save"}</Button></>}>
      {loading ? <div style={{ textAlign: "center", padding: 24 }}><Spinner /></div> : !company ? <div>Not found.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <ResearchButton subjectType="company" subjectId={id} subjectLabel={company.name} prefill={{ name: company.name, website: domain, industry }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Domain"><Input value={domain} onChange={(e) => setDomain(e.target.value)} /></Field>
            <Field label="Industry"><Input value={industry} onChange={(e) => setIndustry(e.target.value)} /></Field>
            <Field label="Owner"><Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.fullName}</option>)}</Select></Field>
          </div>
          <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
          <div>
            <div style={{ fontSize: t.font.xs, fontWeight: 600, textTransform: "uppercase", color: t.color.textMuted, marginBottom: 6 }}>Contacts ({contacts.length})</div>
            {contacts.length === 0 ? <div style={{ fontSize: t.font.sm, color: t.color.textFaint }}>No contacts.</div> : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{contacts.map((c) => <Badge key={c.id} tone="neutral">{c.fullName}</Badge>)}</div>
            )}
          </div>
          <div>
            <div style={{ fontSize: t.font.xs, fontWeight: 600, textTransform: "uppercase", color: t.color.textMuted, marginBottom: 6 }}>Deals ({deals.length})</div>
            {deals.length === 0 ? <div style={{ fontSize: t.font.sm, color: t.color.textFaint }}>No deals.</div> : (
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
        </div>
      )}
    </Modal>
  );
}
