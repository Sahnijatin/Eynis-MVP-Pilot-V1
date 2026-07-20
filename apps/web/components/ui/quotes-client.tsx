"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Download, Send, CheckCircle, XCircle, Clock3, Eye, Link2, Sparkles, AlertTriangle, FileSpreadsheet, Pencil } from "lucide-react";
import { Button, Modal, Field, Input, Select, Badge, PageHeader, Card, useToast } from "../ds";
import type { Quote, QuoteTemplate, InventoryItem, QuoteSeller, QuoteBillTo } from "../../lib/data";

const BASES = [
  { v: "area", label: "Area (L×W)" },
  { v: "length", label: "Length (L)" },
  { v: "perimeter", label: "Perimeter" },
  { v: "volume", label: "Volume (L×W×H)" },
  { v: "fixed", label: "Fixed / each" },
  { v: "hours", label: "Hours" },
];

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

interface ContactLite { id: string; fullName: string; phoneE164: string; email: string | null }

const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: Math.round(paise) % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const num = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };
const nz = (s: string) => (s.trim() === "" ? null : Math.round(num(s)));
const newKey = () => Math.random().toString(36).slice(2, 9);

// GSTIN shape check (mirrors the API) — a bad value in the GSTIN field otherwise skews
// the Place of Supply and the IGST-vs-CGST/SGST decision.
const GSTIN_RE = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const isValidGstin = (s: string) => GSTIN_RE.test(s.trim().toUpperCase());
// GST state codes → names, for the Place of Supply selector.
const GST_STATES: [string, string][] = [
  ["01", "Jammu & Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"],
  ["05", "Uttarakhand"], ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"],
  ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"], ["13", "Nagaland"], ["14", "Manipur"],
  ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"],
  ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"],
  ["25", "Daman & Diu"], ["26", "Dadra & Nagar Haveli and Daman & Diu"], ["27", "Maharashtra"],
  ["28", "Andhra Pradesh (Old)"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"],
  ["33", "Tamil Nadu"], ["34", "Puducherry"], ["35", "Andaman & Nicobar Islands"], ["36", "Telangana"],
  ["37", "Andhra Pradesh"], ["38", "Ladakh"], ["97", "Other Territory"], ["99", "Centre Jurisdiction"],
];

function blankLine(groupName: string): DraftLine {
  return { key: newKey(), groupName, name: "", kind: "material", costBasis: "area", lengthMm: "", widthMm: "", heightMm: "", quantity: "1", inventoryItemId: "", unitRateInr: "", wastagePct: "0", laborHours: "0", materialUnit: "sqft" };
}

const MAX_IMAGES_PER_ROW = 3;

// Resize a picked image to a JPEG data URL before it leaves the browser: caps the
// longest edge at 1600px and re-encodes as JPEG. Big enough for a crisp full view
// (opened via the PDF's "Image N" links) yet bounded, and normalises any format
// (HEIC/WebP/PNG) to JPEG. Resolves to null if the file can't be read as an image.
function resizeImageToDataUrl(file: File, maxEdge = 1600, quality = 0.72): Promise<string | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) { resolve(null); return; }
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = typeof reader.result === "string" ? reader.result : "";
    };
    reader.readAsDataURL(file);
  });
}

function statusTone(s: string): "neutral" | "accent" | "success" | "danger" | "warning" {
  return s === "accepted" ? "success" : s === "sent" ? "accent" : s === "rejected" ? "danger" : s === "expired" ? "warning" : "neutral";
}

export function QuotesClient({ initialQuotes, templates, inventory }: { initialQuotes: Quote[]; templates: QuoteTemplate[]; inventory: InventoryItem[] }) {
  const toast = useToast();
  const [quotes, setQuotes] = useState<Quote[]>(initialQuotes);
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState<Quote | null>(null);
  const [viewing, setViewing] = useState<Quote | null>(null);
  // Reject reason is collected in an accessible in-modal field (not a blocking prompt).
  const [rejecting, setRejecting] = useState<Quote | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/quotes?limit=100", { cache: "no-store" });
      const data = (await res.json()) as { items?: Quote[] };
      if (data.items) setQuotes(data.items);
      else throw new Error("Unexpected response");
    } catch {
      // Don't leave the list silently stale after an action — tell the user it
      // may be out of date so they can reload.
      toast.push("Couldn't refresh the quotes list — it may be out of date. Reload to see the latest.", "error");
    }
  }, [toast]);

  // Open the editor with the FULL quote — the list omits per-piece images (they can be
  // large), so re-fetch the single quote to load them, THEN open (the builder seeds its
  // state on mount, so it must receive the complete quote up front).
  const openEdit = useCallback(async (q: Quote) => {
    try {
      const res = await fetch(`/api/quotes/${q.id}`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; quote?: Quote };
      setEditing(data.ok && data.quote ? data.quote : q);
    } catch {
      setEditing(q); // fall back to the list item (letterhead/lines present, images may be absent)
    }
  }, []);

  // In-flight guard: a double-click on Send must not fire the action twice.
  const actingRef = useRef(false);
  const act = useCallback(async (id: string, action: "send" | "accept" | "reject" | "expire", reason?: string) => {
    if (actingRef.current) return;
    let body: Record<string, unknown> = {};
    if (action === "reject") {
      if (reason && reason.trim()) body = { reason: reason.trim() };
    }
    actingRef.current = true;
    try {
      const res = await fetch(`/api/quotes/${id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as { ok: boolean; error?: string; minTotalPaise?: number; followup?: { enrolled: boolean } };
      if (!data.ok) {
        toast.push(data.minTotalPaise ? `${data.error}. Minimum price to clear the floor: ${rupees(data.minTotalPaise)}` : (data.error ?? "Action failed"), "error");
        return;
      }
      if (action === "send") toast.push(data.followup?.enrolled ? "Quote sent — follow-up started" : "Quote sent (no customer linked, so no follow-up)", data.followup?.enrolled ? "success" : "info");
      else toast.push(`Quote ${{ accept: "accepted", reject: "rejected", expire: "expired" }[action]}`, "success");
      refresh();
    } catch {
      toast.push("Network error — please try again.", "error");
    } finally {
      actingRef.current = false;
    }
  }, [toast, refresh]);

  // Copy the customer's self-serve link. Re-mints the token (only its hash is
  // stored, so the raw link can't be re-read) — any previously shared link stops
  // working, which is also how you revoke one.
  const copyLink = useCallback(async (id: string) => {
    const res = await fetch(`/api/quotes/${id}/public-link`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
    if (!data.ok || !data.url) { toast.push(data.error ?? "Could not create the link", "error"); return; }
    try {
      await navigator.clipboard.writeText(data.url);
      toast.push("Customer link copied — sharing it replaces any earlier link", "success");
    } catch {
      window.prompt("Copy the customer link:", data.url);
    }
  }, [toast]);

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
              <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                <th style={{ padding: "8px 10px" }}>Quote</th>
                <th style={{ padding: "8px 10px" }}>Title</th>
                <th style={{ padding: "8px 10px" }}>Customer</th>
                <th style={{ padding: "8px 10px" }}>Status</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Total</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--text-subtle)" }}>No quotes yet. Click “New Quote” to build one.</td></tr>
              )}
              {quotes.map((q) => (
                <tr key={q.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{q.number}</td>
                  <td style={{ padding: "8px 10px" }}>{q.title}</td>
                  <td style={{ padding: "8px 10px", color: q.contactName ? "#0f172a" : "#64748b" }}>{q.contactName ?? "—"}</td>
                  <td style={{ padding: "8px 10px" }}><Badge tone={statusTone(q.status)}>{q.status}</Badge></td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{rupees(q.grandTotalPaise)}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noreferrer" title="Download PDF" aria-label={`Download PDF for ${q.number}`}>
                      <Button variant="secondary" size="sm"><Download className="w-3.5 h-3.5" /></Button>
                    </a>{" "}
                    {q.status !== "draft" && <Button variant="secondary" size="sm" onClick={() => setViewing(q)} title="View quote" aria-label={`View quote ${q.number}`}><Eye className="w-3.5 h-3.5" /></Button>}{" "}
                    {q.status !== "draft" && <Button variant="secondary" size="sm" onClick={() => copyLink(q.id)} title="Copy customer link (replaces any earlier link)" aria-label={`Copy customer link for ${q.number}`}><Link2 className="w-3.5 h-3.5" /></Button>}{" "}
                    {q.status === "draft" && <Button variant="secondary" size="sm" onClick={() => openEdit(q)} title="Edit draft" aria-label={`Edit draft ${q.number}`}><Pencil className="w-3.5 h-3.5" /></Button>}{" "}
                    {q.status === "draft" && <Button variant="secondary" size="sm" onClick={() => act(q.id, "send")}><Send className="w-3.5 h-3.5" /> Send</Button>}{" "}
                    {q.status === "sent" && <Button variant="secondary" size="sm" onClick={() => act(q.id, "accept")}><CheckCircle className="w-3.5 h-3.5" /> Accept</Button>}{" "}
                    {q.status === "sent" && <Button variant="secondary" size="sm" onClick={() => { setRejecting(q); setRejectReason(""); }} title="Mark rejected"><XCircle className="w-3.5 h-3.5" /> Reject</Button>}{" "}
                    {q.status === "sent" && <Button variant="secondary" size="sm" onClick={() => act(q.id, "expire")} title="Mark expired" aria-label={`Mark ${q.number} expired`}><Clock3 className="w-3.5 h-3.5" /></Button>}{" "}
                    {q.status === "accepted" && (
                      <a href={`/api/quotes/${q.id}/busy-export?format=csv`} target="_blank" rel="noreferrer" title="Export a BUSY-ready sales voucher (import via Administration → Import Voucher)">
                        <Button variant="secondary" size="sm"><FileSpreadsheet className="w-3.5 h-3.5" /> Busy</Button>
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(building || editing) && (
        <QuoteBuilder
          templates={templates}
          inventory={inventory}
          editQuote={editing}
          onClose={() => { setBuilding(false); setEditing(null); }}
          onSaved={() => { setBuilding(false); setEditing(null); refresh(); }}
        />
      )}

      {viewing && <QuoteView quote={viewing} onClose={() => setViewing(null)} />}

      {rejecting && (
        <Modal title={`Reject ${rejecting.number}`} onClose={() => setRejecting(null)} width={420} footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button onClick={() => { const id = rejecting.id; setRejecting(null); act(id, "reject", rejectReason); }}>Reject quote</Button>
          </div>
        }>
          <Field label="Reason (optional)">
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} aria-label="Reason for rejection"
              placeholder="Why is this quote being rejected?"
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 14, resize: "vertical", boxSizing: "border-box" }} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

// Read-only detail for a quote that has left draft (sent/accepted/rejected/expired) —
// non-drafts are immutable, so this shows the frozen lines + internal totals.
function QuoteView({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const dims = (l: Quote["lineItems"][number]) => {
    const parts = [l.lengthMm, l.widthMm, l.heightMm].filter((v): v is number => typeof v === "number" && v > 0);
    return parts.length ? parts.join(" × ") + " mm" : "—";
  };
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null);
  const timeline = [
    quote.sentAt && `Sent ${when(quote.sentAt)}`,
    quote.acceptedAt && `Accepted ${when(quote.acceptedAt)}`,
    quote.rejectedAt && `Rejected ${when(quote.rejectedAt)}${quote.rejectedReason ? ` — ${quote.rejectedReason}` : ""}`,
    quote.status === "expired" && quote.validUntil && `Expired (was valid until ${when(quote.validUntil)})`,
  ].filter(Boolean);
  return (
    <Modal title={`${quote.number} — ${quote.title}`} onClose={onClose} width={760} footer={
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
        <Badge tone={statusTone(quote.status)}>{quote.status}</Badge>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    }>
      <div style={{ display: "grid", gap: 12 }}>
        {(quote.contactName || timeline.length > 0) && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", display: "grid", gap: 2 }}>
            {quote.contactName && <div>Customer: <strong>{quote.contactName}</strong>{quote.contactPhone ? ` · ${quote.contactPhone}` : ""}</div>}
            {timeline.map((t) => <div key={String(t)}>{t}</div>)}
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                <th style={{ padding: "6px 8px" }}>Component</th>
                <th style={{ padding: "6px 8px" }}>Piece</th>
                <th style={{ padding: "6px 8px" }}>Dimensions</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Qty</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Rate</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {quote.lineItems.map((l) => (
                <tr key={l.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "6px 8px" }}>{l.name}</td>
                  <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{l.groupName}</td>
                  <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{dims(l)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{l.computedQty} {l.materialUnit}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{rupees(l.unitRatePaise)}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{rupees(l.lineCostPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ background: "var(--surface-inset)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "grid", gap: 4, fontSize: 14 }}>
          <div style={{ fontSize: 12, color: "var(--text-subtle)", marginBottom: 2 }}>Internal cost breakdown (not shown on the customer quote)</div>
          <Row label="Material" value={rupees(quote.materialCostPaise)} />
          <Row label="Labor" value={rupees(quote.laborCostPaise)} />
          <Row label="Overhead" value={rupees(quote.overheadPaise)} />
          <Row label="Margin" value={rupees(quote.marginPaise)} />
          <div style={{ borderTop: "1px solid #cbd5e1", margin: "4px 0" }} />
          <Row label="Subtotal (taxable)" value={rupees(quote.totalPaise)} />
          {quote.gstPercent > 0 && <Row label={`GST @ ${quote.gstPercent}%`} value={rupees(quote.gstPaise)} />}
          <Row label={<strong>Grand total</strong>} value={<strong>{rupees(quote.grandTotalPaise)}</strong>} />
        </div>
        {quote.terms && <div style={{ fontSize: 13, color: "var(--text-muted)" }}><strong>Terms:</strong> {quote.terms}</div>}
        {quote.notes && <div style={{ fontSize: 13, color: "var(--text-muted)" }}><strong>Notes:</strong> {quote.notes}</div>}
      </div>
    </Modal>
  );
}

function QuoteBuilder({ templates, inventory, editQuote, onClose, onSaved }: { templates: QuoteTemplate[]; inventory: InventoryItem[]; editQuote: Quote | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isEdit = !!editQuote;
  const [title, setTitle] = useState(editQuote?.title ?? "");
  const [templateId, setTemplateId] = useState("");
  const [overheadPct, setOverheadPct] = useState(String(editQuote?.overheadPct ?? 15));
  const [marginPct, setMarginPct] = useState(String(editQuote?.marginPct ?? 45));
  const [marginFloorPct, setMarginFloorPct] = useState(String(editQuote?.marginFloorPct ?? 30));
  const [gstPct, setGstPct] = useState(String(editQuote?.gstPercent ?? 18));
  // Validity date — drives the PDF's "Valid Until" line, the default terms' "valid for N
  // days", and auto-expiry. New quotes default to 15 days out; edits keep the saved date.
  const [validUntil, setValidUntil] = useState(
    editQuote?.validUntil ? new Date(editQuote.validUntil).toISOString().slice(0, 10)
      : editQuote ? "" : new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10),
  );
  // Seed edit state without rounding away sub-rupee precision — Math.round here
  // silently changed a draft's totals on an open→save round-trip (₹12.50 → ₹13).
  const [discountInr, setDiscountInr] = useState(String((editQuote?.discountPaise ?? 0) / 100));
  const [laborRateInr, setLaborRateInr] = useState(String((editQuote?.lineItems?.[0]?.laborRatePaise ?? 15000) / 100));
  const [lines, setLines] = useState<DraftLine[]>(
    editQuote?.lineItems?.length
      ? editQuote.lineItems.map((l) => ({
          key: newKey(), groupName: l.groupName, name: l.name, kind: l.kind, costBasis: l.costBasis,
          lengthMm: l.lengthMm != null ? String(l.lengthMm) : "", widthMm: l.widthMm != null ? String(l.widthMm) : "",
          heightMm: l.heightMm != null ? String(l.heightMm) : "", quantity: String(l.quantity),
          inventoryItemId: l.inventoryItemId ?? "", unitRateInr: l.inventoryItemId ? "" : String(l.unitRatePaise / 100),
          wastagePct: String(l.wastagePct), laborHours: String(l.laborHours), materialUnit: l.materialUnit,
        }))
      : [blankLine("General")],
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  // Customer: "" = none, "new" = new customer, else an existing contact id.
  const [contacts, setContacts] = useState<ContactLite[]>([]);
  const [custSel, setCustSel] = useState(editQuote?.contactId ?? "");
  const [newCust, setNewCust] = useState({ fullName: "", phone: "", email: "" });

  // Quotation letterhead — seller (issuer) + bill-to, snapshotted on the quote and
  // rendered on the PDF. Collapsible; the seller block is carried forward from the
  // last quote server-side, so it's typed once.
  const [showLetterhead, setShowLetterhead] = useState(false);
  const [seller, setSeller] = useState<QuoteSeller>(editQuote?.seller ?? {});
  const [billTo, setBillTo] = useState<QuoteBillTo>(editQuote?.billTo ?? {});
  const setS = (patch: Partial<QuoteSeller>) => setSeller((s) => ({ ...s, ...patch }));
  const setB = (patch: Partial<QuoteBillTo>) => setBillTo((b) => ({ ...b, ...patch }));

  // Per-piece images (keyed by groupName), shown on the PDF after the Quantity column.
  const [lineImages, setLineImages] = useState<Record<string, string[]>>(editQuote?.lineImages ?? {});
  const addImages = async (group: string, files: FileList | null) => {
    if (!files || !files.length) return;
    const room = MAX_IMAGES_PER_ROW - (lineImages[group]?.length ?? 0);
    if (room <= 0) { toast.push(`Up to ${MAX_IMAGES_PER_ROW} images per item`, "info"); return; }
    const picked = await Promise.all(Array.from(files).slice(0, room).map((f) => resizeImageToDataUrl(f)));
    const valid = picked.filter((s): s is string => !!s);
    if (!valid.length) { toast.push("Could not read that image", "error"); return; }
    setLineImages((m) => ({ ...m, [group]: [...(m[group] ?? []), ...valid].slice(0, MAX_IMAGES_PER_ROW) }));
  };
  const removeImage = (group: string, idx: number) =>
    setLineImages((m) => ({ ...m, [group]: (m[group] ?? []).filter((_, i) => i !== idx) }));

  // Per-piece HSN/SAC codes (keyed by groupName), shown on the quotation PDF and used
  // for the GST voucher. Kept as free text here; the API sanitizes to 4–8 digits.
  const [hsn, setHsn] = useState<Record<string, string>>(editQuote?.hsn ?? {});
  const setHsnCode = (group: string, code: string) =>
    setHsn((m) => ({ ...m, [group]: code.replace(/\D/g, "").slice(0, 8) }));

  // Per-piece quantity (keyed by groupName; default 1) — shown on the PDF, splits the
  // piece's allocated price into a unit price.
  const [qty, setQty] = useState<Record<string, number>>(editQuote?.qty ?? {});
  const setQtyFor = (group: string, v: string) => {
    const n = Math.floor(Number(v));
    setQty((m) => { const next = { ...m }; if (Number.isFinite(n) && n > 1) next[group] = Math.min(n, 100_000); else delete next[group]; return next; });
  };

  // Per-piece GST rate override (keyed by groupName). Empty → the piece uses the quote's
  // default GST %. Enables mixed-rate quotes.
  const [gstRate, setGstRate] = useState<Record<string, number>>(editQuote?.gst ?? {});
  const setGstRateFor = (group: string, v: string) => {
    setGstRate((m) => { const next = { ...m }; const n = Number(v); if (v.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 28) next[group] = n; else delete next[group]; return next; });
  };

  useEffect(() => {
    fetch("/api/contacts?limit=200", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { items?: ContactLite[] }) => { if (d.items) setContacts(d.items); })
      .catch(() => { /* picker just stays empty */ });
  }, []);

  const invMap = useMemo(() => Object.fromEntries(inventory.map((i) => [i.id, i])), [inventory]);

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
        key: newKey(), groupName: tpl.name, name: c.name, kind: c.kind, costBasis: c.costBasis,
        lengthMm: c.defaultLengthMm != null ? String(c.defaultLengthMm) : "",
        widthMm: c.defaultWidthMm != null ? String(c.defaultWidthMm) : "",
        heightMm: c.defaultHeightMm != null ? String(c.defaultHeightMm) : "",
        quantity: String(c.defaultQuantity), inventoryItemId: c.inventoryItemId ?? "",
        unitRateInr: c.inventoryItemId ? "" : String(Math.round(c.defaultRatePaise / 100)),
        wastagePct: String(c.wastagePct), laborHours: String(c.laborHours), materialUnit: c.materialUnit,
      })),
    );
    if (!title) setTitle(tpl.name);
  };

  const ratePaiseFor = useCallback((l: DraftLine): number => {
    if (l.inventoryItemId && invMap[l.inventoryItemId]) return Math.round(invMap[l.inventoryItemId].unitCostPaise);
    return Math.round(num(l.unitRateInr) * 100);
  }, [invMap]);

  // Debounced live cost preview. A sequence counter drops out-of-order
  // responses: two rapid edits put two /calc calls in flight, and without the
  // guard the slower (stale) one could land last and render outdated totals.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSeq = useRef(0);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const seq = ++previewSeq.current;
      const payload = {
        overheadPct: num(overheadPct), marginPct: num(marginPct), marginFloorPct: num(marginFloorPct),
        discountPaise: Math.round(num(discountInr) * 100),
        lines: lines.map((l) => ({
          costBasis: l.costBasis, lengthMm: nz(l.lengthMm), widthMm: nz(l.widthMm), heightMm: nz(l.heightMm),
          quantity: num(l.quantity), unitRatePaise: ratePaiseFor(l),
          wastagePct: num(l.wastagePct), laborHours: num(l.laborHours), laborRatePaise: Math.round(num(laborRateInr) * 100),
        })),
      };
      try {
        const res = await fetch("/api/quotes/calc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const data = (await res.json()) as { preview?: Preview };
        if (data.preview && seq === previewSeq.current) setPreview(data.preview);
      } catch { /* preview is display-only — keep the last one on a failed fetch */ }
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [lines, overheadPct, marginPct, marginFloorPct, discountInr, laborRateInr, ratePaiseFor]);

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
          key: newKey(), groupName: String(o.groupName ?? title ?? "General"), name: String(o.name ?? "Component"),
          kind: String(o.kind ?? "material"), costBasis: String(o.costBasis ?? "area"),
          lengthMm: o.lengthMm != null ? String(o.lengthMm) : "", widthMm: o.widthMm != null ? String(o.widthMm) : "",
          heightMm: o.heightMm != null ? String(o.heightMm) : "", quantity: String(o.quantity ?? 1),
          inventoryItemId: "", unitRateInr: "", wastagePct: "0", laborHours: "0", materialUnit: String(o.materialUnit ?? "sqft"),
        })));
        toast.push(`Added ${data.lines.length} line item(s) — review dimensions & rates`, "success");
      } else {
        toast.push(data.note ?? "Nothing to add", "info");
      }
    } catch {
      toast.push("Network error — could not parse the description. Please try again.", "error");
    } finally {
      setAiBusy(false);
    }
  };

  const linePayload = () => lines.filter((l) => l.name.trim()).map((l) => ({
    groupName: l.groupName || "General", name: l.name.trim(), kind: l.kind, costBasis: l.costBasis,
    lengthMm: nz(l.lengthMm), widthMm: nz(l.widthMm), heightMm: nz(l.heightMm), quantity: num(l.quantity),
    inventoryItemId: l.inventoryItemId || null,
    unitRatePaise: l.inventoryItemId ? undefined : Math.round(num(l.unitRateInr) * 100),
    wastagePct: num(l.wastagePct), laborHours: num(l.laborHours), laborRatePaise: Math.round(num(laborRateInr) * 100),
    materialUnit: l.materialUnit,
  }));

  const save = async () => {
    if (!title.trim()) { toast.push("Give the quote a title", "error"); return; }
    if (custSel === "new" && !newCust.phone.trim()) { toast.push("Enter the new customer's phone (needed for follow-up)", "error"); return; }
    setSaving(true);
    try {
      const knobs = {
        overheadPct: num(overheadPct), marginPct: num(marginPct), marginFloorPct: num(marginFloorPct),
        gstPercent: num(gstPct), discountPaise: Math.round(num(discountInr) * 100),
        validUntil: validUntil || null,
      };
      const customer = custSel === "new" ? { customer: { fullName: newCust.fullName, phoneE164: newCust.phone, email: newCust.email } }
        : custSel ? { contactId: custSel } : {};
      let res: Response;
      // Only keep images for pieces (groups) that still exist on the quote.
      const groups = new Set(lines.map((l) => l.groupName || "General"));
      const prunedImages = Object.fromEntries(Object.entries(lineImages).filter(([g, arr]) => groups.has(g) && arr.length));
      const prunedHsn = Object.fromEntries(Object.entries(hsn).filter(([g, code]) => groups.has(g) && code.trim()));
      const prunedQty = Object.fromEntries(Object.entries(qty).filter(([g, n]) => groups.has(g) && n > 1));
      const prunedGst = Object.fromEntries(Object.entries(gstRate).filter(([g]) => groups.has(g)));
      const letterhead = { seller, billTo, lineImages: prunedImages, hsn: prunedHsn, qty: prunedQty, gst: prunedGst };
      if (isEdit && editQuote) {
        res = await fetch(`/api/quotes/${editQuote.id}`, { method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim(), ...knobs, ...(custSel && custSel !== "new" ? { contactId: custSel } : {}), ...letterhead, lines: linePayload() }) });
      } else {
        res = await fetch("/api/quotes", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim(), templateId: templateId || undefined, ...knobs, ...customer, ...letterhead, lines: linePayload() }) });
      }
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) { toast.push(data.error ?? "Could not save quote", "error"); return; }
      toast.push(isEdit ? "Quote updated" : "Quote created", "success");
      onSaved();
    } catch {
      toast.push("Network error — the quote was not saved. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  const q = preview?.quote;
  const floorViolation = q?.floorViolation ?? false;
  const gstPaise = q ? Math.round(q.totalPaise * num(gstPct) / 100) : 0;
  // Show the edit quote's existing contact in the picker even before the list loads.
  const contactOptions = useMemo(() => {
    const seen = new Set(contacts.map((c) => c.id));
    const extra = editQuote?.contactId && editQuote.contactName && !seen.has(editQuote.contactId)
      ? [{ id: editQuote.contactId, fullName: editQuote.contactName, phoneE164: editQuote.contactPhone ?? "", email: editQuote.contactEmail }]
      : [];
    return [...extra, ...contacts];
  }, [contacts, editQuote]);

  return (
    <Modal title={isEdit ? `Edit ${editQuote?.number}` : "New Quote"} onClose={onClose} width={880} footer={
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
        <div style={{ fontSize: 14 }}>
          {q ? <>Grand total <strong style={{ fontSize: 18 }}>{rupees(q.totalPaise + gstPaise)}</strong> · margin {q.marginPctActual.toFixed(1)}%</> : "—"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : isEdit ? "Save changes" : "Create quote"}</Button>
        </div>
      </div>
    }>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <Field label="Quote title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Executive Dining Table — 6 seater" /></Field>
          {!isEdit && (
            <Field label="Start from template">
              <Select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— Blank —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          )}
        </div>

        {/* Customer — links the quote so Send starts the follow-up drip */}
        <div style={{ display: "grid", gridTemplateColumns: custSel === "new" ? "1fr" : "1fr", gap: 10 }}>
          <Field label="Customer" hint="Linking a customer is what lets Send start the WhatsApp/email follow-up.">
            <Select value={custSel} onChange={(e) => setCustSel(e.target.value)}>
              <option value="">— No customer —</option>
              <option value="new">＋ New customer…</option>
              {contactOptions.map((c) => <option key={c.id} value={c.id}>{c.fullName}{c.phoneE164 ? ` · ${c.phoneE164}` : ""}</option>)}
            </Select>
          </Field>
          {custSel === "new" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <Input value={newCust.fullName} onChange={(e) => setNewCust({ ...newCust, fullName: e.target.value })} placeholder="Customer name" />
              <Input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} placeholder="Phone (e.g. 98xxxxxxxx)" />
              <Input value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} placeholder="Email (optional)" />
            </div>
          )}
        </div>

        {/* Quotation letterhead — appears on the PDF (seller tax/bank details + bill-to) */}
        <div style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
          <button type="button" onClick={() => setShowLetterhead((v) => !v)} aria-expanded={showLetterhead}
            style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--surface-inset)", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
            <span>Quotation letterhead — company & bank details, bill-to (shown on the PDF)</span>
            <span aria-hidden="true">{showLetterhead ? "▲" : "▼"}</span>
          </button>
          {showLetterhead && (
            <div style={{ padding: 12, display: "grid", gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>YOUR COMPANY (seller) — carried forward from your last quote</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Input value={seller.name ?? ""} onChange={(e) => setS({ name: e.target.value })} placeholder="Company name" />
                  <Input value={seller.phone ?? ""} onChange={(e) => setS({ phone: e.target.value })} placeholder="Phone" />
                  <Input value={seller.address ?? ""} onChange={(e) => setS({ address: e.target.value })} placeholder="Address" />
                  <Input value={seller.email ?? ""} onChange={(e) => setS({ email: e.target.value })} placeholder="Email (optional)" />
                  <Input value={seller.gstin ?? ""} onChange={(e) => setS({ gstin: e.target.value })} placeholder="GSTIN" aria-invalid={!!seller.gstin && !isValidGstin(seller.gstin)} />
                  <Input value={seller.pan ?? ""} onChange={(e) => setS({ pan: e.target.value })} placeholder="PAN number" />
                </div>
                {!!seller.gstin && !isValidGstin(seller.gstin) && (
                  <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>Seller GSTIN doesn’t look valid — expected 15 characters (2-digit state code + PAN + entity/Z/checksum).</div>
                )}
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", margin: "10px 0 6px" }}>BANK DETAILS</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <Input value={seller.bankAccountName ?? ""} onChange={(e) => setS({ bankAccountName: e.target.value })} placeholder="Account holder" />
                  <Input value={seller.bankAccountNumber ?? ""} onChange={(e) => setS({ bankAccountNumber: e.target.value })} placeholder="Account number" />
                  <Input value={seller.bankName ?? ""} onChange={(e) => setS({ bankName: e.target.value })} placeholder="Bank" />
                  <Input value={seller.bankBranch ?? ""} onChange={(e) => setS({ bankBranch: e.target.value })} placeholder="Branch" />
                  <Input value={seller.ifsc ?? ""} onChange={(e) => setS({ ifsc: e.target.value })} placeholder="IFSC code" />
                  <Input value={seller.upi ?? ""} onChange={(e) => setS({ upi: e.target.value })} placeholder="UPI ID" />
                </div>
                <div style={{ marginTop: 8 }}>
                  <Input value={seller.signatory ?? ""} onChange={(e) => setS({ signatory: e.target.value })} placeholder="Authorised signatory name (optional)" />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>BILL TO (customer)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Input value={billTo.name ?? ""} onChange={(e) => setB({ name: e.target.value })} placeholder="Customer / company name" />
                  <Input value={billTo.phone ?? ""} onChange={(e) => setB({ phone: e.target.value })} placeholder="Phone" />
                  <Input value={billTo.address ?? ""} onChange={(e) => setB({ address: e.target.value })} placeholder="Address" />
                  <Input value={billTo.pin ?? ""} onChange={(e) => setB({ pin: e.target.value })} placeholder="Pin code" />
                  <Input value={billTo.gstin ?? ""} onChange={(e) => setB({ gstin: e.target.value })} placeholder="GSTIN (optional)" aria-invalid={!!billTo.gstin && !isValidGstin(billTo.gstin)} />
                  <Select value={billTo.stateCode ?? ""} onChange={(e) => setB({ stateCode: e.target.value })} aria-label="Place of Supply (ship-to state)">
                    <option value="">Place of Supply (state)…</option>
                    {GST_STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                  </Select>
                </div>
                {!!billTo.gstin && !isValidGstin(billTo.gstin) && (
                  <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>Customer GSTIN doesn’t look valid. Set Place of Supply below so tax is computed correctly.</div>
                )}
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Place of Supply defaults to the customer’s GSTIN state; set it explicitly for an unregistered/B2C buyer shipping to another state.</div>
              </div>
            </div>
          )}
        </div>

        {/* AI-assist */}
        <div style={{ background: "var(--surface-inset)", border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 13, color: "var(--text-muted)" }}>
            <Sparkles className="w-4 h-4" /> Describe the piece — AI drafts the line items (you review dimensions & rates)
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Input value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder='e.g. "6-seater dining table, 1800×900mm sheesham top, 4 legs 720mm, brass handles"' />
            <Button variant="secondary" onClick={runAi} disabled={aiBusy || !aiText.trim()}>{aiBusy ? "Reading…" : "Draft"}</Button>
          </div>
        </div>

        {/* Pricing knobs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          <Field label="Overhead %"><Input type="number" value={overheadPct} onChange={(e) => setOverheadPct(e.target.value)} /></Field>
          <Field label="Markup %"><Input type="number" value={marginPct} onChange={(e) => setMarginPct(e.target.value)} /></Field>
          <Field label="Floor %"><Input type="number" value={marginFloorPct} onChange={(e) => setMarginFloorPct(e.target.value)} /></Field>
          <Field label="Labor ₹/hr"><Input type="number" value={laborRateInr} onChange={(e) => setLaborRateInr(e.target.value)} /></Field>
          <Field label="Discount ₹"><Input type="number" value={discountInr} onChange={(e) => setDiscountInr(e.target.value)} /></Field>
          <Field label="GST %"><Input type="number" value={gstPct} onChange={(e) => setGstPct(e.target.value)} /></Field>
        </div>
        <div style={{ marginTop: 10, maxWidth: 220 }}>
          <Field label="Valid until"><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
        </div>

        {/* Line items */}
        <div style={{ display: "grid", gap: 8 }}>
          {lines.map((l, i) => (
            <div key={l.key} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, display: "grid", gap: 6 }}>
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
              <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right" }}>
                {preview?.lines[i] ? <>{preview.lines[i].computedQty} {l.materialUnit} · {rupees(preview.lines[i].lineCostPaise)}</> : null}
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addLine}><Plus className="w-3.5 h-3.5" /> Add component</Button>
        </div>

        {/* Images per item — up to 3 per piece, shown on the PDF after the Quantity column */}
        {(() => {
          const groups = Array.from(new Set(lines.map((l) => l.groupName || "General")));
          if (groups.length === 0) return null;
          return (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>PIECE DETAILS — quantity, HSN/SAC, GST rate & up to {MAX_IMAGES_PER_ROW} images per piece (shown on the quotation PDF)</div>
              {groups.map((g) => {
                const imgs = lineImages[g] ?? [];
                return (
                  <div key={g} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 130, fontSize: 13, fontWeight: 600 }}>{g}</div>
                    <Input type="number" min={1} value={qty[g] ?? ""} onChange={(e) => setQtyFor(g, e.target.value)} placeholder="Qty"
                      style={{ width: 64 }} aria-label={`Quantity for ${g}`} title="Quantity (default 1)" />
                    <Input type="number" min={0} max={28} step="0.01" value={gstRate[g] ?? ""} onChange={(e) => setGstRateFor(g, e.target.value)} placeholder={`GST% (${num(gstPct)})`}
                      style={{ width: 96 }} aria-label={`GST rate for ${g}`} title={`GST rate for this piece — blank uses the quote default (${num(gstPct)}%)`} />
                    <Input value={hsn[g] ?? ""} onChange={(e) => setHsnCode(g, e.target.value)} placeholder="HSN/SAC"
                      inputMode="numeric" style={{ width: 96 }} aria-label={`HSN/SAC code for ${g}`} title="4–8 digit HSN (goods) or SAC (services) code" />
                    {imgs.map((src, i) => (
                      <div key={i} style={{ position: "relative", width: 48, height: 48 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
                        <button type="button" onClick={() => removeImage(g, i)} title="Remove"
                          style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, border: "none", background: "var(--danger-solid)", color: "#fff", fontSize: 11, lineHeight: "18px", cursor: "pointer" }}>×</button>
                      </div>
                    ))}
                    {imgs.length < MAX_IMAGES_PER_ROW && (
                      <label style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: 6, border: "1px dashed var(--border-strong)", color: "var(--text-muted)", cursor: "pointer", fontSize: 20 }}>
                        +
                        <input type="file" accept="image/*" multiple style={{ display: "none" }}
                          onChange={(e) => { addImages(g, e.target.files); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Totals — internal view (the customer PDF never shows cost/margin) */}
        {q && (
          <div style={{ background: "var(--surface-inset)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "grid", gap: 4, fontSize: 14 }}>
            <div style={{ fontSize: 12, color: "var(--text-subtle)", marginBottom: 2 }}>Internal cost breakdown (not shown on the customer quote)</div>
            <Row label="Material" value={rupees(q.materialCostPaise)} />
            <Row label="Labor" value={rupees(q.laborCostPaise)} />
            <Row label="Overhead" value={rupees(q.overheadPaise)} />
            <Row label="Margin" value={rupees(q.marginPaise)} />
            <div style={{ borderTop: "1px solid #cbd5e1", margin: "4px 0" }} />
            <Row label="Subtotal (taxable)" value={rupees(q.totalPaise)} />
            {num(gstPct) > 0 && <Row label={`GST @ ${num(gstPct)}%`} value={rupees(gstPaise)} />}
            <Row label={<strong>Grand total</strong>} value={<strong>{rupees(q.totalPaise + gstPaise)}</strong>} />
            {floorViolation && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--warn-text)", background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: 6, padding: "6px 8px", marginTop: 6 }}>
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
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-muted)" }}>{label}</span><span>{value}</span></div>;
}
