"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button, Card, PageHeader, Field, Input, Select, Badge, EmptyState, Modal, Spinner, useToast, tokens as t,
} from "../ds";
import { DataGrid, type GridColumn } from "./data-grid";
import { CrmTabs } from "./crm-tabs";
import { jsonRequest } from "../../lib/client-request";
import type { DealRow, PipelineRow, PipelineStage, ForecastSummary, DealSuggestionRow } from "../../lib/data";

// Date-only values ("YYYY-MM-DD" from <input type="date">) must parse as LOCAL
// dates — new Date("YYYY-MM-DD") is UTC midnight, which renders (and flags
// "overdue") a day early in timezones west of UTC.
const parseDate = (iso: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
};
const fmtDate = (iso: string | null) => (iso ? parseDate(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

// ── Money formatting ──────────────────────────────────────────────────────────
function fmtMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-IN")}`;
  }
}
// Compact for big headline numbers (₹55.7L style via Indian grouping).
function fmtCompact(amount: number, currency = "INR"): string {
  if (amount >= 1_00_00_000) return `${currency === "INR" ? "₹" : ""}${(amount / 1_00_00_000).toFixed(2)} Cr`;
  if (amount >= 1_00_000) return `${currency === "INR" ? "₹" : ""}${(amount / 1_00_000).toFixed(2)} L`;
  return fmtMoney(amount, currency);
}

const PIPELINE_EMPTY: PipelineStage[] = [];

export function DealsBoardClient({
  initialPipelines,
  initialDeals,
  initialForecast,
  owners,
  contacts,
  companies,
  initialSuggestions,
}: {
  initialPipelines: PipelineRow[];
  initialDeals: DealRow[];
  initialForecast: ForecastSummary | null;
  owners: Array<{ id: string; fullName: string }>;
  contacts: Array<{ id: string; fullName: string }>;
  companies: Array<{ id: string; name: string }>;
  initialSuggestions: DealSuggestionRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [suggestions, setSuggestions] = useState<DealSuggestionRow[]>(initialSuggestions);
  const [scanning, setScanning] = useState(false);
  useEffect(() => setSuggestions(initialSuggestions), [initialSuggestions]);

  const [pipelineId, setPipelineId] = useState<string>(
    initialPipelines.find((p) => p.isDefault)?.id ?? initialPipelines[0]?.id ?? "",
  );
  const [deals, setDeals] = useState<DealRow[]>(initialDeals);
  const [forecast, setForecast] = useState<ForecastSummary | null>(initialForecast);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<"kanban" | "grid">("kanban");

  // Re-sync from the server after router.refresh() lands new props.
  useEffect(() => setDeals(initialDeals), [initialDeals]);
  useEffect(() => setForecast(initialForecast), [initialForecast]);

  const pipeline = useMemo(
    () => initialPipelines.find((p) => p.id === pipelineId) ?? initialPipelines[0] ?? null,
    [initialPipelines, pipelineId],
  );
  const stages = pipeline?.stages ?? PIPELINE_EMPTY;
  const currency = forecast?.currency ?? "INR";

  const dealsByStage = useMemo(() => {
    const map: Record<string, DealRow[]> = {};
    for (const s of stages) map[s.id] = [];
    for (const d of deals) {
      if (pipeline && d.pipelineId !== pipeline.id) continue;
      (map[d.stageId] ??= []).push(d);
    }
    return map;
  }, [deals, stages, pipeline]);

  async function moveDeal(dealId: string, toStageId: string) {
    const current = deals.find((d) => d.id === dealId);
    if (!current || current.stageId === toStageId) return;
    const toStage = stages.find((s) => s.id === toStageId);
    // Optimistic update.
    setDeals((prev) =>
      prev.map((d) =>
        d.id === dealId
          ? { ...d, stageId: toStageId, stageName: toStage?.name ?? d.stageName, status: toStage?.isWon ? "won" : toStage?.isLost ? "lost" : "open" }
          : d,
      ),
    );
    try {
      const res = await fetch(`/api/deals/${dealId}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stageId: toStageId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Move failed");
      toast.push(`Moved to ${toStage?.name ?? "stage"}`, "success");
      router.refresh();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Move failed", "error");
      // Roll back ONLY this deal — resetting to initialDeals would also revert
      // other deals' successful optimistic moves still awaiting router.refresh().
      const original = deals.find((d) => d.id === dealId);
      if (original) setDeals((prev) => prev.map((d) => (d.id === dealId ? original : d)));
    }
  }

  // Safe-mode AI: ask the AI to propose stage moves for the open deals. It only
  // creates pending *suggestions* — nothing moves until a human accepts.
  async function scanForSuggestions() {
    const openDeals = deals.filter((d) => d.status === "open" && (!pipeline || d.pipelineId === pipeline.id));
    if (openDeals.length === 0) { toast.push("No open deals to review", "info"); return; }
    setScanning(true);
    try {
      await Promise.all(openDeals.map((d) => fetch(`/api/deals/${d.id}/suggest`, { method: "POST" }).catch(() => null)));
      const res = await fetch("/api/deals/suggestions?status=pending");
      const data = await res.json();
      const items: DealSuggestionRow[] = data.ok ? data.items : [];
      setSuggestions(items);
      toast.push(items.length ? `${items.length} suggestion(s) ready to review` : "No moves suggested right now", items.length ? "success" : "info");
    } catch { toast.push("Could not get suggestions", "error"); }
    finally { setScanning(false); }
  }

  async function resolveSuggestion(s: DealSuggestionRow, action: "accept" | "dismiss") {
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id)); // optimistic
    try {
      const res = await fetch(`/api/deals/suggestions/${s.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed");
      toast.push(action === "accept" ? `Moved "${s.dealTitle}" → ${s.suggestedStageName}` : "Suggestion dismissed", "success");
      if (action === "accept") router.refresh();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Failed", "error");
      setSuggestions((prev) => [s, ...prev]); // roll back
    }
  }

  // Inline grid edit. Stage changes go through the move endpoint (logs a
  // transition + auto-sets won/lost); everything else is a plain PATCH.
  async function editDealCell(row: DealRow, key: string, value: string) {
    if (key === "stage") { await moveDeal(row.id, value); return; }
    const payload: Record<string, unknown> =
      key === "value" ? { value: value === "" ? null : Number(value) } :
      key === "owner" ? { ownerId: value || null } :
      key === "expectedClose" ? { expectedCloseAt: value || null } :
      { [key]: value || null };
    const res = await fetch(`/api/deals/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Update failed");
    toast.push("Deal updated", "success");
    router.refresh();
  }

  async function deleteDeals(rows: DealRow[]) {
    // Best-effort: keep going past a failed row and ALWAYS refresh — aborting
    // mid-batch left already-deleted rows visible (and selected) in the grid.
    let failed = 0;
    for (const r of rows) {
      const res = await jsonRequest(`/api/deals/${r.id}`, { method: "DELETE" });
      if (!res.ok) failed++;
    }
    router.refresh();
    if (failed > 0) throw new Error(`${failed} of ${rows.length} could not be deleted`);
    toast.push(`Deleted ${rows.length} deal(s)`, "success");
  }

  const ownerOptions = owners.map((o) => ({ value: o.id, label: o.fullName }));
  const gridColumns: GridColumn<DealRow>[] = [
    { key: "title", header: "Deal", accessor: (d) => d.title, editable: true, width: 220 },
    { key: "value", header: "Value", type: "number", accessor: (d) => d.value ?? "", editable: true, align: "right", render: (d) => d.value != null ? fmtMoney(d.value, d.currency || currency) : <span>—</span> },
    { key: "stage", header: "Stage", type: "select", accessor: (d) => d.stageName ?? "", editAccessor: (d) => d.stageId, editable: true, options: stages.map((s) => ({ value: s.id, label: s.name })) },
    { key: "contact", header: "Contact", accessor: (d) => d.contactName ?? "" },
    { key: "owner", header: "Owner", type: "select", accessor: (d) => d.ownerName ?? "", editAccessor: (d) => d.ownerId ?? "", editable: true, options: ownerOptions },
    { key: "status", header: "Status", accessor: (d) => d.status, render: (d) => <Badge tone={d.status === "won" ? "success" : d.status === "lost" ? "danger" : "neutral"}>{d.status}</Badge> },
    { key: "expectedClose", header: "Expected close", type: "date", accessor: (d) => d.expectedCloseAt ?? "", editable: true, render: (d) => fmtDate(d.expectedCloseAt) || <span>—</span> },
    { key: "source", header: "Source", accessor: (d) => d.source ?? "", defaultHidden: true },
    { key: "createdAt", header: "Created", type: "date", accessor: (d) => d.createdAt, render: (d) => fmtDate(d.createdAt), defaultHidden: true },
  ];

  if (!pipeline) {
    return (
      <div style={{ padding: 24 }}>
        <CrmTabs />
        <PageHeader title="Deals" subtitle="Pipeline & forecasting" />
        <EmptyState
          title="No pipeline yet"
          description="Your sales pipeline is being set up. Refresh in a moment."
          action={<Button onClick={() => router.refresh()}>Refresh</Button>}
        />
      </div>
    );
  }

  const hasDeals = deals.some((d) => d.pipelineId === pipeline.id);

  return (
    <div style={{ padding: 24 }}>
      <CrmTabs />
      <PageHeader
        title="Deals"
        subtitle="Track opportunities through your pipeline and forecast revenue"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, overflow: "hidden" }}>
              {(["kanban", "grid"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding: "7px 12px", fontSize: t.font.sm, fontWeight: 600, border: "none", cursor: "pointer",
                  background: view === v ? t.color.accent : t.color.surface, color: view === v ? "#fff" : t.color.textMuted,
                }}>{v === "kanban" ? "Kanban" : "Grid"}</button>
              ))}
            </div>
            {initialPipelines.length > 1 && (
              <Select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} style={{ minWidth: 160 }}>
                {initialPipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            )}
            <Button variant="secondary" onClick={scanForSuggestions} disabled={scanning}>{scanning ? <Spinner size={14} /> : "✨ Get AI suggestions"}</Button>
            <Button onClick={() => setCreating(true)}>+ New deal</Button>
          </div>
        }
      />

      {/* Safe-mode AI suggestions — the AI proposes, you decide */}
      {suggestions.length > 0 && (
        <Card style={{ padding: 14, marginBottom: 14, borderLeft: `3px solid ${t.color.accent}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <span style={{ fontWeight: 600, color: t.color.text }}>🤖 AI suggestions</span>
            <Badge tone="accent">{suggestions.length}</Badge>
            <span style={{ fontSize: t.font.xs, color: t.color.textFaint }}>Review and approve — nothing moves until you accept.</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {suggestions.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600, fontSize: t.font.sm }}>
                    {s.dealTitle}: <span style={{ color: t.color.textMuted }}>{s.fromStageName}</span> → <span style={{ color: t.color.accent }}>{s.suggestedStageName}</span>
                    {s.confidence != null && <Badge tone="neutral" style={{ marginLeft: 6 }}>{s.confidence}%</Badge>}
                  </div>
                  <div style={{ fontSize: t.font.xs, color: t.color.textMuted }}>{s.reason}</div>
                </div>
                <Button onClick={() => resolveSuggestion(s, "accept")}>Accept</Button>
                <Button variant="secondary" onClick={() => resolveSuggestion(s, "dismiss")}>Dismiss</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Forecast strip */}
      <ForecastStrip forecast={forecast} currency={currency} />

      {/* Board / Grid */}
      {!hasDeals ? (
        <EmptyState
          title="No deals yet"
          description="Create your first deal to start tracking your pipeline and forecast."
          icon="📊"
          action={<Button onClick={() => setCreating(true)}>+ New deal</Button>}
        />
      ) : view === "grid" ? (
        <DataGrid<DealRow>
          rows={deals.filter((d) => d.pipelineId === pipeline.id)}
          columns={gridColumns}
          getId={(d) => d.id}
          storageKey="deals"
          exportFilename="deals"
          onEditCell={editDealCell}
          onDeleteRows={deleteDeals}
          searchPlaceholder="Search deals…"
          emptyTitle="No deals"
        />
      ) : (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
          {stages.map((stage) => {
            const stageDeals = dealsByStage[stage.id] ?? [];
            const stageValue = stageDeals.reduce((sum, d) => sum + (d.value ?? 0), 0);
            const isOver = dropTarget === stage.id;
            return (
              <div
                key={stage.id}
                onDragOver={(e) => { e.preventDefault(); setDropTarget(stage.id); }}
                onDragLeave={() => setDropTarget((cur) => (cur === stage.id ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTarget(null);
                  if (dragId) moveDeal(dragId, stage.id);
                  setDragId(null);
                }}
                style={{
                  flex: "0 0 270px", minWidth: 270, background: isOver ? t.color.accentSoft : t.color.bg,
                  border: `1px solid ${isOver ? t.color.accent : t.color.border}`, borderRadius: t.radius.lg, padding: 10,
                  transition: "background 0.12s, border-color 0.12s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, padding: "0 2px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: t.font.sm, color: t.color.text }}>{stage.name}</span>
                    {stage.isWon && <Badge tone="success">won</Badge>}
                    {stage.isLost && <Badge tone="danger">lost</Badge>}
                    {!stage.isWon && !stage.isLost && <Badge tone="neutral">{stage.probability}%</Badge>}
                  </div>
                  <span style={{ fontSize: t.font.xs, color: t.color.textMuted }}>{stageDeals.length}</span>
                </div>
                <div style={{ fontSize: t.font.xs, color: t.color.textMuted, marginBottom: 8, padding: "0 2px" }}>
                  {fmtMoney(stageValue, currency)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 40 }}>
                  {stageDeals.map((d) => (
                    <DealCard key={d.id} deal={d} currency={currency} onDragStart={() => setDragId(d.id)} onDragEnd={() => setDragId(null)} dragging={dragId === d.id} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <CreateDealModal
          stages={stages}
          owners={owners}
          contacts={contacts}
          companies={companies}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ── Forecast strip ──────────────────────────────────────────────────────────
function ForecastStrip({ forecast, currency }: { forecast: ForecastSummary | null; currency: string }) {
  const cells: Array<{ label: string; value: string; hint?: string }> = forecast
    ? [
        { label: "Open pipeline", value: fmtCompact(forecast.openValue, currency), hint: `${forecast.openCount} open deals` },
        { label: "Weighted forecast", value: fmtCompact(forecast.weightedForecast, currency), hint: "value × stage probability" },
        { label: "Closing this month", value: fmtCompact(forecast.byPeriod.thisMonth, currency), hint: "weighted" },
        { label: "Closing this quarter", value: fmtCompact(forecast.byPeriod.thisQuarter, currency), hint: "weighted" },
        { label: "Win rate", value: `${Math.round(forecast.winRate * 100)}%`, hint: `${forecast.wonCount}W · ${forecast.lostCount}L` },
      ]
    : [];
  if (!forecast) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 18 }}>
      {cells.map((c) => (
        <Card key={c.label} style={{ padding: 14 }}>
          <div style={{ fontSize: t.font.xs, color: t.color.textMuted, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{c.label}</div>
          <div style={{ fontSize: t.font.xl, fontWeight: 700, color: t.color.text, marginTop: 4 }}>{c.value}</div>
          {c.hint && <div style={{ fontSize: t.font.xs, color: t.color.textFaint, marginTop: 2 }}>{c.hint}</div>}
        </Card>
      ))}
    </div>
  );
}

// ── Deal card ─────────────────────────────────────────────────────────────────
function DealCard({
  deal, currency, onDragStart, onDragEnd, dragging,
}: {
  deal: DealRow; currency: string; onDragStart: () => void; onDragEnd: () => void; dragging: boolean;
}) {
  const close = deal.expectedCloseAt ? parseDate(deal.expectedCloseAt) : null;
  const closeLabel = close ? close.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : null;
  const overdue = close && deal.status === "open" ? close.getTime() < Date.now() : false;
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      style={{
        background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md,
        padding: 10, cursor: "grab", boxShadow: t.shadow.sm, opacity: dragging ? 0.5 : 1,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: t.font.sm, color: t.color.text, marginBottom: 4 }}>{deal.title}</div>
      {deal.value != null && (
        <div style={{ fontSize: t.font.base, fontWeight: 700, color: t.color.accent, marginBottom: 4 }}>{fmtMoney(deal.value, deal.currency || currency)}</div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: t.font.xs, color: t.color.textMuted }}>
        {deal.contactName && <span>👤 {deal.contactName}</span>}
        {closeLabel && (
          <span style={{ color: overdue ? t.color.danger : t.color.textMuted }}>📅 {closeLabel}{overdue ? " (overdue)" : ""}</span>
        )}
      </div>
      {deal.ownerName && <div style={{ fontSize: t.font.xs, color: t.color.textFaint, marginTop: 4 }}>Owner: {deal.ownerName}</div>}
    </div>
  );
}

// ── Create deal modal ───────────────────────────────────────────────────────
function CreateDealModal({
  stages, owners, contacts, companies, onClose, onCreated,
}: {
  stages: PipelineStage[];
  owners: Array<{ id: string; fullName: string }>;
  contacts: Array<{ id: string; fullName: string }>;
  companies: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [ownerId, setOwnerId] = useState("");
  const [contactId, setContactId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [expectedCloseAt, setExpectedCloseAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) { setError("Title is required"); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          value: value === "" ? null : Number(value),
          stageId: stageId || undefined,
          ownerId: ownerId || undefined,
          contactId: contactId || undefined,
          companyId: companyId || undefined,
          expectedCloseAt: expectedCloseAt || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not create deal");
      toast.push("Deal created", "success");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create deal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New deal"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Spinner size={14} /> : "Create deal"}</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Corporate retreat — 30 rooms" autoFocus />
        </Field>
        <Field label="Value (₹)" hint="Optional — leave blank if unknown">
          <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} placeholder="850000" />
        </Field>
        <Field label="Stage">
          <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{!s.isWon && !s.isLost ? ` (${s.probability}%)` : ""}</option>
            ))}
          </Select>
        </Field>
        <Field label="Expected close date" hint="Optional">
          <Input type="date" value={expectedCloseAt} onChange={(e) => setExpectedCloseAt(e.target.value)} />
        </Field>
        {owners.length > 0 && (
          <Field label="Owner" hint="Optional">
            <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Unassigned</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.fullName}</option>)}
            </Select>
          </Field>
        )}
        {contacts.length > 0 && (
          <Field label="Contact" hint="Optional">
            <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">None</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </Select>
          </Field>
        )}
        {companies.length > 0 && (
          <Field label="Company" hint="Optional">
            <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">None</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        {error && <div style={{ color: t.color.danger, fontSize: t.font.sm }}>{error}</div>}
      </div>
    </Modal>
  );
}
