"use client";

import { useState } from "react";
import { Button, Card, PageHeader, Field, Input, Select, Badge, EmptyState, Modal, useToast, tokens as t } from "../ds";
import { CampaignsNav } from "./campaigns-nav";
import type { LeadSegmentRow, SegmentRules } from "../../lib/data";

// Saved audience segments: build a reusable filter once, target any campaign at it.
const LEAD_STATUSES = ["pending", "called", "completed", "failed", "opted_out"];
const csv = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);

function rulesSummary(r: SegmentRules): string {
  const parts: string[] = [];
  if (r.tagsAny?.length) parts.push(`has any tag: ${r.tagsAny.join(", ")}`);
  if (r.tagsAll?.length) parts.push(`has all tags: ${r.tagsAll.join(", ")}`);
  if (r.tagsNot?.length) parts.push(`excludes: ${r.tagsNot.join(", ")}`);
  if (r.status?.length) parts.push(`status ∈ ${r.status.join("/")}`);
  if (r.consent !== undefined) parts.push(`consent=${r.consent}`);
  if (r.company) parts.push(`company ~ "${r.company}"`);
  if (r.search) parts.push(`search ~ "${r.search}"`);
  return parts.length ? parts.join(" · ") : "matches all leads";
}

export function SegmentsClient({ initialSegments }: { initialSegments: LeadSegmentRow[] }) {
  const toast = useToast();
  const [segments, setSegments] = useState<LeadSegmentRow[]>(initialSegments);
  const [creating, setCreating] = useState(false);
  const [previews, setPreviews] = useState<Record<string, number | "…">>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [tagsAny, setTagsAny] = useState("");
  const [tagsNot, setTagsNot] = useState("");
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [consent, setConsent] = useState<"any" | "true" | "false">("any");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildRules(): SegmentRules {
    const rules: SegmentRules = {};
    if (csv(tagsAny).length) rules.tagsAny = csv(tagsAny);
    if (csv(tagsNot).length) rules.tagsNot = csv(tagsNot);
    if (statuses.size) rules.status = [...statuses];
    if (consent !== "any") rules.consent = consent === "true";
    if (company.trim()) rules.company = company.trim();
    return rules;
  }

  async function create() {
    if (!name.trim()) { setError("Name is required"); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/segments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), rules: buildRules() }) });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Create failed"); return; }
      setSegments((s) => [data.segment, ...s]);
      setName(""); setTagsAny(""); setTagsNot(""); setStatuses(new Set()); setConsent("any"); setCompany(""); setCreating(false);
      toast.push("Segment created", "success");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    await fetch(`/api/segments/${id}`, { method: "DELETE" });
    setSegments((s) => s.filter((x) => x.id !== id));
    setConfirmId(null);
    toast.push("Segment deleted");
  }

  async function preview(id: string) {
    setPreviews((p) => ({ ...p, [id]: "…" }));
    const res = await fetch(`/api/segments/${id}/preview`, { cache: "no-store" });
    const data = await res.json();
    setPreviews((p) => ({ ...p, [id]: data.ok ? data.total : 0 }));
  }

  const toggleStatus = (s: string) => setStatuses((prev) => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next; });

  return (
    <div style={{ padding: 28, maxWidth: 960, margin: "0 auto" }}>
      <CampaignsNav active="/segments" />
      <PageHeader title="Segments" subtitle="Reusable audiences. Target a campaign or sequence at one to contact only matching leads."
        actions={!creating && <Button onClick={() => setCreating(true)}>+ New segment</Button>} />

      {creating && (
        <Card style={{ marginBottom: 18 }}>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VIP — gold tier" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Has any of these tags" hint="comma-separated"><Input value={tagsAny} onChange={(e) => setTagsAny(e.target.value)} placeholder="vip, gold" /></Field>
            <Field label="Excludes tags" hint="comma-separated"><Input value={tagsNot} onChange={(e) => setTagsNot(e.target.value)} placeholder="churned" /></Field>
          </div>
          <Field label="Status">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {LEAD_STATUSES.map((s) => (
                <button key={s} type="button" onClick={() => toggleStatus(s)} style={{ ...chip, ...(statuses.has(s) ? chipOn : {}) }}>{s}</button>
              ))}
            </div>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Consent"><Select value={consent} onChange={(e) => setConsent(e.target.value as "any" | "true" | "false")}><option value="any">Any</option><option value="true">Consented only</option><option value="false">Not consented</option></Select></Field>
            <Field label="Company contains"><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" /></Field>
          </div>
          {error && <div style={{ color: t.color.danger, fontSize: t.font.sm, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={create} disabled={busy}>{busy ? "Saving…" : "Create segment"}</Button>
            <Button variant="ghost" onClick={() => { setCreating(false); setError(null); }}>Cancel</Button>
          </div>
        </Card>
      )}

      {segments.length === 0 ? (
        <EmptyState icon="🎯" title="No segments yet" description="Create one to target campaigns at a specific audience." action={<Button onClick={() => setCreating(true)}>+ New segment</Button>} />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {segments.map((s) => (
            <Card key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: t.color.text }}>{s.name}</div>
                <div style={{ color: t.color.textMuted, fontSize: t.font.sm }}>{rulesSummary(s.rules)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {previews[s.id] !== undefined ? <Badge tone="success">{previews[s.id]} leads</Badge> : <Button size="sm" variant="secondary" onClick={() => preview(s.id)}>Preview count</Button>}
                <Button size="sm" variant="danger" onClick={() => setConfirmId(s.id)}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {confirmId && (
        <Modal title="Delete segment?" onClose={() => setConfirmId(null)}
          footer={<><Button variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button><Button variant="danger" onClick={() => remove(confirmId)}>Delete</Button></>}>
          <p style={{ margin: 0, color: t.color.textMuted, fontSize: t.font.base }}>Campaigns targeting this segment will revert to contacting all leads.</p>
        </Modal>
      )}
    </div>
  );
}

const chip: React.CSSProperties = { background: t.color.surfaceMuted, color: t.color.text, padding: "6px 12px", borderRadius: t.radius.pill, border: `1px solid ${t.color.border}`, cursor: "pointer", fontSize: t.font.sm };
const chipOn: React.CSSProperties = { background: t.color.accent, color: "#fff", borderColor: t.color.accent };
