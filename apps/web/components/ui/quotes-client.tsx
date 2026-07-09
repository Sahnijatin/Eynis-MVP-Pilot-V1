"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Download, Send, CheckCircle, Sparkles, AlertTriangle } from "lucide-react";
import { Button, Modal, Field, Input, Select, Badge, PageHeader, Card, useToast } from "../ds";
import type { Quote, QuoteTemplate, InventoryItem } from "../../lib/data";

const BASES = [
  { v: "area", label: "Area (L×W)" },
  { v: "length", label: "Length (L)" },
  { v: "perimeter", label: "Perimeter" },
  { v: "volume", label: "Volume (L×W×H)" },
  { v: "fixed", label: "Fixed / each" },
  { v: "hours", label: "Hours" },
];
const KINDS = ["material", "labor", "hardware", "finish", "other"];

interface DraftLine {
  key: string;
  groupName: string;
  name: string;
  kind: string;
  costBasis: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  quantity: string;
  inventoryItemId: string; // "" = manual rate
  unitRateInr: string; // manual rate (rupees), used when not inventory-linked
  wastagePct: string;
  laborHours: string;
  materialUnit: string;
}

interface Preview {
  quote: {
    materialCostPaise: number; laborCostPaise: number; overheadPaise: number;
    subtotalCostPaise: number; marginPaise: number; totalPaise: number;
    marginPctActual: number; floorViolation: boolean; minTotalPaise: number;
  };
  lines: { lineCostPaise: number; computedQty: number }[];
}

const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN")}`;
const num = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };
const nz = (s: string) => (s.trim() === "" ? null : Math.round(num(s)));
const newKey = () => Math.random().toString(36).slice(2, 9);

function blankLine(groupName: string): DraftLine {
  return { key: newKey(), groupName, name: "", kind: "material", costBasis: "area", lengthMm: "", widthMm: "", heightMm: "", quantity: "1", inventoryItemId: "", unitRateInr: "", wastagePct: "0", laborHours: "0", materialUnit: "sqft" };
}

function statusTone(s: string): "neutral" | "accent" | "success" | "danger" | "warning" {
  return s === "accepted" ? "success" : s === "sent" ? "accent" : s === "rejected" ? "danger" : s === "expired" ? "warning" : "neutral";
}

export function QuotesClient({ initialQuotes, templates, inventory }: { initialQuotes: Quote[]; templates: QuoteTemplate[]; inventory: InventoryItem[] }) {
  const toast = useToast();
  const [quotes, setQuotes] = useState<Quote[]>(initialQuotes);
  const [building, setBuilding] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/quotes?limit=100", { cache: "no-store" });
    const data = (await res.json()) as { items?: Quote[] };
    if (data.items) setQuotes(data.items);
  }, []);

  const act = useCallback(async (id: string, action: "send" | "accept" | "reject" | "expire") => {
    const res = await fetch(`/api/quotes/${id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = (await res.json()) as { ok: boolean; error?: string; minTotalPaise?: number };
    if (!data.ok) {
      toast.push(data.minTotalPaise ? `${data.error}. Minimum price to clear the floor: ${rupees(data.minTotalPaise)}` : (data.error ?? "Action failed"), "error");
      return;
    }
    toast.push(`Quote ${action === "send" ? "sent" : action + "ed"}`, "success");
    refresh();
  }, [toast, refresh]);

  return (
    <div>
      <PageHeader
        title="Quote Builder"
        subtitle="Component-based costing — dimensions in, priced quote out."
        actions={<Button onClick={() => setBuilding(true)}><Plus className="w-4 h-4" /> New Quote</Button>}
      />

      <Card>
        <div style={{ overflowX: "auto" }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748b" }}>
                <th style={{ padding: "8px 10px" }}>Quote</th>
                <th style={{ padding: "8px 10px" }}>Title</th>
                <th style={{ padding: "8px 10px" }}>Status</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Total</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Margin</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No quotes yet. Click “New Quote” to build one.</td></tr>
              )}
              {quotes.map((q) => (
                <tr key={q.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{q.number}</td>
                  <td style={{ padding: "8px 10px" }}>{q.title}</td>
                  <td style={{ padding: "8px 10px" }}><Badge tone={statusTone(q.status)}>{q.status}</Badge></td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{rupees(q.totalPaise)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{q.marginPctActual.toFixed(1)}%</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noreferrer" title="Download PDF">
                      <Button variant="secondary" size="sm"><Download className="w-3.5 h-3.5" /></Button>
                    </a>{" "}
                    {q.status === "draft" && <Button variant="secondary" size="sm" onClick={() => act(q.id, "send")}><Send className="w-3.5 h-3.5" /> Send</Button>}{" "}
                    {(q.status === "sent" || q.status === "draft") && <Button variant="secondary" size="sm" onClick={() => act(q.id, "accept")}><CheckCircle className="w-3.5 h-3.5" /> Accept</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {building && (
        <QuoteBuilder
          templates={templates}
          inventory={inventory}
          onClose={() => setBuilding(false)}
          onCreated={() => { setBuilding(false); refresh(); }}
        />
      )}
    </div>
  );
}

function QuoteBuilder({ templates, inventory, onClose, onCreated }: { templates: QuoteTemplate[]; inventory: InventoryItem[]; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [overheadPct, setOverheadPct] = useState("15");
  const [marginPct, setMarginPct] = useState("45");
  const [marginFloorPct, setMarginFloorPct] = useState("30");
  const [laborRateInr, setLaborRateInr] = useState("150");
  const [lines, setLines] = useState<DraftLine[]>([blankLine("General")]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const invMap = useMemo(() => Object.fromEntries(inventory.map((i) => [i.id, i])), [inventory]);

  // Applying a template prefills lines + pricing knobs.
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setOverheadPct(String(tpl.overheadPct));
    setMarginPct(String(tpl.marginPct));
    setMarginFloorPct(String(tpl.marginFloorPct));
    setLaborRateInr(String(Math.round(tpl.laborRatePaise / 100)));
    setLines(
      tpl.components.map((c) => ({
        key: newKey(),
        groupName: tpl.name,
        name: c.name,
        kind: c.kind,
        costBasis: c.costBasis,
        lengthMm: c.defaultLengthMm != null ? String(c.defaultLengthMm) : "",
        widthMm: c.defaultWidthMm != null ? String(c.defaultWidthMm) : "",
        heightMm: c.defaultHeightMm != null ? String(c.defaultHeightMm) : "",
        quantity: String(c.defaultQuantity),
        inventoryItemId: c.inventoryItemId ?? "",
        unitRateInr: c.inventoryItemId ? "" : String(Math.round(c.defaultRatePaise / 100)),
        wastagePct: String(c.wastagePct),
        laborHours: String(c.laborHours),
        materialUnit: c.materialUnit,
      })),
    );
    if (!title) setTitle(tpl.name);
  };

  const ratePaiseFor = useCallback((l: DraftLine): number => {
    if (l.inventoryItemId && invMap[l.inventoryItemId]) return Math.round(invMap[l.inventoryItemId].unitCostInr) * 100;
    return Math.round(num(l.unitRateInr) * 100);
  }, [invMap]);

  // Debounced live cost preview.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const payload = {
        overheadPct: num(overheadPct), marginPct: num(marginPct), marginFloorPct: num(marginFloorPct),
        lines: lines.map((l) => ({
          costBasis: l.costBasis,
          lengthMm: nz(l.lengthMm), widthMm: nz(l.widthMm), heightMm: nz(l.heightMm),
          quantity: num(l.quantity), unitRatePaise: ratePaiseFor(l),
          wastagePct: num(l.wastagePct), laborHours: num(l.laborHours),
          laborRatePaise: Math.round(num(laborRateInr) * 100),
        })),
      };
      const res = await fetch("/api/quotes/calc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = (await res.json()) as { preview?: Preview };
      if (data.preview) setPreview(data.preview);
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [lines, overheadPct, marginPct, marginFloorPct, laborRateInr, ratePaiseFor]);

  const setLine = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine(ls[ls.length - 1]?.groupName ?? "General")]);
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const runAi = async () => {
    if (!aiText.trim()) return;
    setAiBusy(true);
    try {
      const res = await fetch("/api/quotes/parse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: aiText }) });
      const data = (await res.json()) as { lines?: Array<Record<string, unknown>>; note?: string };
      if (data.lines && data.lines.length) {
        setLines(data.lines.map((o) => ({
          key: newKey(),
          groupName: String(o.groupName ?? title ?? "General"),
          name: String(o.name ?? "Component"),
          kind: String(o.kind ?? "material"),
          costBasis: String(o.costBasis ?? "area"),
          lengthMm: o.lengthMm != null ? String(o.lengthMm) : "",
          widthMm: o.widthMm != null ? String(o.widthMm) : "",
          heightMm: o.heightMm != null ? String(o.heightMm) : "",
          quantity: String(o.quantity ?? 1),
          inventoryItemId: "",
          unitRateInr: "",
          wastagePct: "0",
          laborHours: "0",
          materialUnit: String(o.materialUnit ?? "sqft"),
        })));
        toast.push(`Added ${data.lines.length} line item(s) — review dimensions & rates`, "success");
      } else {
        toast.push(data.note ?? "Nothing to add", "info");
      }
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!title.trim()) { toast.push("Give the quote a title", "error"); return; }
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        templateId: templateId || undefined,
        overheadPct: num(overheadPct), marginPct: num(marginPct), marginFloorPct: num(marginFloorPct),
        lines: lines.filter((l) => l.name.trim()).map((l) => ({
          groupName: l.groupName || "General",
          name: l.name.trim(),
          kind: l.kind,
          costBasis: l.costBasis,
          lengthMm: nz(l.lengthMm), widthMm: nz(l.widthMm), heightMm: nz(l.heightMm),
          quantity: num(l.quantity),
          inventoryItemId: l.inventoryItemId || null,
          unitRatePaise: l.inventoryItemId ? undefined : Math.round(num(l.unitRateInr) * 100),
          wastagePct: num(l.wastagePct),
          laborHours: num(l.laborHours),
          laborRatePaise: Math.round(num(laborRateInr) * 100),
          materialUnit: l.materialUnit,
        })),
      };
      const res = await fetch("/api/quotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) { toast.push(data.error ?? "Could not create quote", "error"); return; }
      toast.push("Quote created", "success");
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  const q = preview?.quote;
  const floorViolation = q?.floorViolation ?? false;

  return (
    <Modal title="New Quote" onClose={onClose} width={880} footer={
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
        <div style={{ fontSize: 14 }}>
          {q ? <>Total <strong style={{ fontSize: 18 }}>{rupees(q.totalPaise)}</strong> · margin {q.marginPctActual.toFixed(1)}%</> : "—"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Create quote"}</Button>
        </div>
      </div>
    }>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <Field label="Quote title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Riviera Dining Table — 6 seater" /></Field>
          <Field label="Start from template">
            <Select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">— Blank —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>

        {/* AI-assist */}
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 13, color: "#475569" }}>
            <Sparkles className="w-4 h-4" /> Describe the piece — AI drafts the line items (you review dimensions & rates)
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Input value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder='e.g. "6-seater dining table, 1800×900mm sheesham top, 4 legs 720mm, brass handles"' />
            <Button variant="secondary" onClick={runAi} disabled={aiBusy || !aiText.trim()}>{aiBusy ? "Reading…" : "Draft"}</Button>
          </div>
        </div>

        {/* Pricing knobs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          <Field label="Overhead %"><Input type="number" value={overheadPct} onChange={(e) => setOverheadPct(e.target.value)} /></Field>
          <Field label="Markup %"><Input type="number" value={marginPct} onChange={(e) => setMarginPct(e.target.value)} /></Field>
          <Field label="Margin floor %"><Input type="number" value={marginFloorPct} onChange={(e) => setMarginFloorPct(e.target.value)} /></Field>
          <Field label="Labor ₹/hr"><Input type="number" value={laborRateInr} onChange={(e) => setLaborRateInr(e.target.value)} /></Field>
        </div>

        {/* Line items */}
        <div style={{ display: "grid", gap: 8 }}>
          {lines.map((l, i) => (
            <div key={l.key} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, display: "grid", gap: 6 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: 6 }}>
                <Input value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder={`Component ${i + 1} (e.g. Table top)`} />
                <Input value={l.groupName} onChange={(e) => setLine(l.key, { groupName: e.target.value })} placeholder="Piece / group" />
                <Select value={l.costBasis} onChange={(e) => setLine(l.key, { costBasis: e.target.value })}>
                  {BASES.map((b) => <option key={b.v} value={b.v}>{b.label}</option>)}
                </Select>
                <Button variant="secondary" size="sm" onClick={() => removeLine(l.key)} title="Remove"><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr) 1.3fr", gap: 6 }}>
                <Input type="number" value={l.lengthMm} onChange={(e) => setLine(l.key, { lengthMm: e.target.value })} placeholder="L mm" />
                <Input type="number" value={l.widthMm} onChange={(e) => setLine(l.key, { widthMm: e.target.value })} placeholder="W mm" />
                <Input type="number" value={l.heightMm} onChange={(e) => setLine(l.key, { heightMm: e.target.value })} placeholder="H mm" />
                <Input type="number" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} placeholder="Qty" />
                <Input type="number" value={l.wastagePct} onChange={(e) => setLine(l.key, { wastagePct: e.target.value })} placeholder="Waste %" />
                <Input type="number" value={l.laborHours} onChange={(e) => setLine(l.key, { laborHours: e.target.value })} placeholder="Labor hrs" />
                {inventory.length > 0
                  ? <Select value={l.inventoryItemId} onChange={(e) => setLine(l.key, { inventoryItemId: e.target.value })}>
                      <option value="">Manual rate…</option>
                      {inventory.map((it) => <option key={it.id} value={it.id}>{it.name} (₹{it.unitCostInr}/{it.unit})</option>)}
                    </Select>
                  : <Input type="number" value={l.unitRateInr} onChange={(e) => setLine(l.key, { unitRateInr: e.target.value })} placeholder="₹/unit" />}
              </div>
              {inventory.length > 0 && !l.inventoryItemId && (
                <Input type="number" value={l.unitRateInr} onChange={(e) => setLine(l.key, { unitRateInr: e.target.value })} placeholder="₹/unit (material rate — or pick a material above)" />
              )}
              <div style={{ fontSize: 12, color: "#64748b", textAlign: "right" }}>
                {preview?.lines[i] ? <>{preview.lines[i].computedQty} {l.materialUnit} · {rupees(preview.lines[i].lineCostPaise)}</> : null}
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addLine}><Plus className="w-3.5 h-3.5" /> Add component</Button>
        </div>

        {/* Totals */}
        {q && (
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, display: "grid", gap: 4, fontSize: 14 }}>
            <Row label="Material" value={rupees(q.materialCostPaise)} />
            <Row label="Labor" value={rupees(q.laborCostPaise)} />
            <Row label="Overhead" value={rupees(q.overheadPaise)} />
            <Row label="Margin" value={rupees(q.marginPaise)} />
            <div style={{ borderTop: "1px solid #cbd5e1", margin: "4px 0" }} />
            <Row label={<strong>Total (selling price)</strong>} value={<strong>{rupees(q.totalPaise)}</strong>} />
            {floorViolation && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 8px", marginTop: 6 }}>
                <AlertTriangle className="w-4 h-4" />
                Margin {q.marginPctActual.toFixed(1)}% is below the {num(marginFloorPct)}% floor. Minimum price to clear it: <strong>{rupees(q.minTotalPaise)}</strong>. You can save a draft, but sending is blocked until the floor is met.
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>{label}</span><span>{value}</span></div>;
}
