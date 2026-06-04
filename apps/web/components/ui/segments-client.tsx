"use client";

import { useState } from "react";
import { Badge } from "./badge";
import type { LeadSegmentRow, SegmentRules } from "../../lib/data";

// Saved audience segments: create a reusable filter (tags / status / fields)
// once, then target any campaign at it. Mirrors the SegmentRules DSL on the API.

const LEAD_STATUSES = ["pending", "called", "completed", "failed", "opted_out"];
const csv = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);
const join = (a?: string[]) => (a ?? []).join(", ");

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
  const [segments, setSegments] = useState<LeadSegmentRow[]>(initialSegments);
  const [creating, setCreating] = useState(false);
  const [previews, setPreviews] = useState<Record<string, number | "…">>({});

  // create-form state
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
      const res = await fetch("/api/segments", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), rules: buildRules() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Create failed"); return; }
      setSegments((s) => [data.segment, ...s]);
      setName(""); setTagsAny(""); setTagsNot(""); setStatuses(new Set()); setConsent("any"); setCompany("");
      setCreating(false);
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this segment? Campaigns targeting it will revert to all leads.")) return;
    await fetch(`/api/segments/${id}`, { method: "DELETE" });
    setSegments((s) => s.filter((x) => x.id !== id));
  }

  async function preview(id: string) {
    setPreviews((p) => ({ ...p, [id]: "…" }));
    const res = await fetch(`/api/segments/${id}/preview`, { cache: "no-store" });
    const data = await res.json();
    setPreviews((p) => ({ ...p, [id]: data.ok ? data.total : 0 }));
  }

  const toggleStatus = (s: string) => setStatuses((prev) => {
    const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next;
  });

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Segments</h1>
          <p style={{ color: "#666", margin: "4px 0 0", fontSize: 14 }}>Reusable audiences. Target a campaign at one in its Settings tab.</p>
        </div>
        {!creating && <button onClick={() => setCreating(true)} style={btnPrimary}>+ New segment</button>}
      </div>

      {creating && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={cardTitle}>New segment</div>
          <Field label="Name"><input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VIP — gold tier" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Has any of these tags (comma-sep)"><input style={input} value={tagsAny} onChange={(e) => setTagsAny(e.target.value)} placeholder="vip, gold" /></Field>
            <Field label="Excludes tags (comma-sep)"><input style={input} value={tagsNot} onChange={(e) => setTagsNot(e.target.value)} placeholder="churned" /></Field>
          </div>
          <Field label="Status">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {LEAD_STATUSES.map((s) => (
                <button key={s} onClick={() => toggleStatus(s)} type="button"
                  style={{ ...chip, ...(statuses.has(s) ? chipOn : {}) }}>{s}</button>
              ))}
            </div>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Consent">
              <select style={input} value={consent} onChange={(e) => setConsent(e.target.value as "any" | "true" | "false")}>
                <option value="any">Any</option><option value="true">Consented only</option><option value="false">Not consented</option>
              </select>
            </Field>
            <Field label="Company contains"><input style={input} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" /></Field>
          </div>
          {error && <div style={{ color: "#991b1b", fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={create} disabled={busy} style={btnPrimary}>{busy ? "Saving…" : "Create segment"}</button>
            <button onClick={() => { setCreating(false); setError(null); }} style={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {segments.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "#666", padding: 32 }}>No segments yet. Create one to target campaigns at a specific audience.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {segments.map((s) => (
            <div key={s.id} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div style={{ color: "#6b7280", fontSize: 13 }}>{rulesSummary(s.rules)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                {previews[s.id] !== undefined
                  ? <Badge label={`${previews[s.id]} leads`} tone="success" />
                  : <button onClick={() => preview(s.id)} style={btnGhost}>Preview count</button>}
                <button onClick={() => remove(s.id)} style={{ ...btnGhost, color: "#991b1b" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 12 }}><label style={lbl}>{label}</label>{children}</div>;
}

const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 16 };
const cardTitle: React.CSSProperties = { fontWeight: 600, marginBottom: 12 };
const lbl: React.CSSProperties = { display: "block", fontSize: 13, color: "#374151", fontWeight: 600, marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", fontFamily: "inherit" };
const btnPrimary: React.CSSProperties = { background: "#0f766e", color: "#fff", padding: "9px 16px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 14 };
const btnGhost: React.CSSProperties = { background: "#f3f4f6", color: "#374151", padding: "8px 14px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 13 };
const chip: React.CSSProperties = { background: "#f3f4f6", color: "#374151", padding: "6px 12px", borderRadius: 999, border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 13 };
const chipOn: React.CSSProperties = { background: "#0f766e", color: "#fff", borderColor: "#0f766e" };
