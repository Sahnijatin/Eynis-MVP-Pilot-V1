"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "./badge";
import type { CampaignLeadRow } from "../../lib/data";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  pending: "neutral", called: "success", failed: "danger", opted_out: "danger", completed: "success",
};

// Leads tab: lists leads with their tags, supports filtering by tag, and bulk
// add/remove of a tag across selected leads (the raw material segments target).
export function CampaignLeadsTab({ campaignId, initialLeads, initialTotal }: {
  campaignId: string; initialLeads: CampaignLeadRow[]; initialTotal: number;
}) {
  const [leads, setLeads] = useState<CampaignLeadRow[]>(initialLeads);
  const [total, setTotal] = useState(initialTotal);
  const [tagFilter, setTagFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (tag: string) => {
    const q = new URLSearchParams({ limit: "200" });
    if (tag.trim()) q.set("tag", tag.trim());
    const res = await fetch(`/api/campaigns/${campaignId}/leads?${q.toString()}`, { cache: "no-store" });
    const data = await res.json();
    if (data.ok) { setLeads(data.items); setTotal(data.page?.total ?? data.items.length); }
  }, [campaignId]);

  // Debounced tag filter.
  useEffect(() => {
    const t = setTimeout(() => { void load(tagFilter); }, 300);
    return () => clearTimeout(t);
  }, [tagFilter, load]);

  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  async function bulk(action: "addTags" | "removeTags") {
    const tag = bulkTag.trim();
    if (!tag || selected.size === 0) return;
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/leads/tag`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds: [...selected], [action]: [tag] }),
      });
      setBulkTag(""); setSelected(new Set());
      await load(tagFilter);
    } finally { setBusy(false); }
  }

  if (initialTotal === 0 && !tagFilter) {
    return (
      <div style={{ ...card, textAlign: "center", padding: 32 }}>
        <p style={{ color: "#666", marginBottom: 16 }}>No leads imported yet.</p>
        <Link href={`/campaigns/${campaignId}/leads/import`} style={btnPrimary}>Import leads from CSV</Link>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder="Filter by tag…" style={{ ...input, width: 180 }} />
        <span style={{ color: "#9ca3af", fontSize: 13 }}>{total} lead{total === 1 ? "" : "s"}</span>
        <div style={{ flex: 1 }} />
        {selected.size > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#374151" }}>{selected.size} selected</span>
            <input value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="tag" style={{ ...input, width: 120 }} />
            <button onClick={() => bulk("addTags")} disabled={busy || !bulkTag.trim()} style={btnPrimary}>Add</button>
            <button onClick={() => bulk("removeTags")} disabled={busy || !bulkTag.trim()} style={btnGhost}>Remove</button>
          </div>
        )}
      </div>

      <div style={card}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#666", borderBottom: "1px solid #eee" }}>
              <th style={{ ...th, width: 28 }}></th>
              <th style={th}>Name</th><th style={th}>Company</th><th style={th}>Phone</th>
              <th style={th}>Tags</th><th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid #f3f4f6", background: selected.has(l.id) ? "#f0fdfa" : undefined }}>
                <td style={td}><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} /></td>
                <td style={td}>{l.firstName} {l.lastName ?? ""}</td>
                <td style={td}>{l.company ?? "—"}</td>
                <td style={td}>{l.phone ?? "—"}</td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {l.tags.length ? l.tags.map((t) => <Badge key={t} label={t} tone="neutral" />) : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </div>
                </td>
                <td style={td}><Badge label={l.status} tone={STATUS_TONE[l.status] ?? "neutral"} /></td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr><td style={{ ...td, color: "#9ca3af" }} colSpan={6}>No leads match this tag.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const card: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 16 };
const th: React.CSSProperties = { padding: "10px 12px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "10px 12px" };
const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, fontFamily: "inherit" };
const btnPrimary: React.CSSProperties = { background: "#0f766e", color: "#fff", padding: "8px 14px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 13, textDecoration: "none" };
const btnGhost: React.CSSProperties = { background: "#f3f4f6", color: "#374151", padding: "8px 14px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 13 };
