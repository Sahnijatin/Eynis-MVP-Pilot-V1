"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Play, Save, Loader2 } from "lucide-react";
import { type RunResult } from "./report-result-table";
import { ReportResultView } from "./report-result-view";

type Visualization = "table" | "bar" | "line" | "pie" | "number";
const VISUALIZATIONS: Array<{ key: Visualization; label: string }> = [
  { key: "table", label: "Table" },
  { key: "bar", label: "Bar chart" },
  { key: "line", label: "Line chart" },
  { key: "pie", label: "Pie chart" },
  { key: "number", label: "Single number" },
];

// Custom report builder (E-16, Phase A). Pick a source, columns, filters, date
// range, group-by, sort; preview against live data; save (private or shared).
// Used for both create (no reportId) and edit (reportId set).

interface SourceColumn { key: string; label: string; type: string }
interface Source { key: string; label: string; permission: string; dateField: string; columns: SourceColumn[]; metric?: { key: string; label: string } }
interface Filter { field: string; op: "eq" | "contains"; value: string }
interface Definition {
  source: string;
  columns: string[];
  filters: Filter[];
  from: string | null;
  to: string | null;
  groupBy: string | null;
  sort: { field: string; dir: "asc" | "desc" } | null;
  visualization: "table" | "bar" | "line" | "pie" | "number";
  limit: number;
}

const ACCENT = "var(--color-primary, #0f766e)";
const inputCls = "w-full px-3 py-2 rounded-lg border border-line text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent-focus";

export function ReportBuilder({ reportId }: { reportId?: string }) {
  const router = useRouter();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const [sourceKey, setSourceKey] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [sortField, setSortField] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [visualization, setVisualization] = useState<Visualization>("table");

  const [preview, setPreview] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  const source = useMemo(() => sources.find((s) => s.key === sourceKey), [sources, sourceKey]);

  // Load source metadata, and (in edit mode) the saved definition.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sres = await fetch("/api/reports/sources", { cache: "no-store" });
        const sdata = (await sres.json()) as { ok: boolean; sources?: Source[] };
        if (!alive) return;
        const srcs = sdata.sources ?? [];
        setSources(srcs);

        if (reportId) {
          const rres = await fetch(`/api/reports/${reportId}`, { cache: "no-store" });
          const rdata = (await rres.json()) as { ok: boolean; report?: { name: string; description: string | null; shared: boolean; definition: Definition } };
          if (alive && rdata.ok && rdata.report) {
            const d = rdata.report.definition;
            setName(rdata.report.name);
            setDescription(rdata.report.description ?? "");
            setShared(rdata.report.shared);
            setSourceKey(d.source);
            setColumns(d.columns ?? []);
            setFilters(d.filters ?? []);
            setFrom(d.from ?? "");
            setTo(d.to ?? "");
            setGroupBy(d.groupBy ?? "");
            if (d.sort) { setSortField(d.sort.field); setSortDir(d.sort.dir); }
            if (d.visualization) setVisualization(d.visualization);
          }
        } else if (srcs.length > 0) {
          selectSource(srcs[0], srcs);
        }
      } catch {
        if (alive) setError("Couldn't load the report builder.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  // Picking a source resets the dependent selections to that source's columns.
  function selectSource(s: Source, all: Source[] = sources) {
    void all;
    setSourceKey(s.key);
    setColumns(s.columns.map((c) => c.key));
    setFilters([]);
    setGroupBy("");
    setSortField("");
    setVisualization("table");
    setPreview(null);
  }

  function toggleColumn(key: string) {
    setColumns((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }

  function buildDefinition(): Definition {
    return {
      source: sourceKey,
      columns,
      filters: filters.filter((f) => f.field && f.value),
      from: from || null,
      to: to || null,
      groupBy: groupBy || null,
      sort: sortField ? { field: sortField, dir: sortDir } : null,
      visualization,
      limit: 500,
    };
  }

  async function runPreview() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ definition: buildDefinition() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Run failed"); setPreview(null); return; }
      setPreview(data as RunResult);
    } catch { setError("Run failed"); }
    finally { setRunning(false); }
  }

  async function save() {
    if (!name.trim()) { setError("Give your report a name first."); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim(), description: description.trim() || null, shared, definition: buildDefinition() };
      const res = reportId
        ? await fetch(`/api/reports/${reportId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Save failed"); return; }
      router.push(reportId ? `/reports/${reportId}` : `/reports/${data.id}`);
    } catch { setError("Save failed"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="card text-sm text-fg-muted">Loading report builder…</div>;

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled report"
              className="text-xl font-semibold text-fg bg-transparent outline-none w-full"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description (optional)"
              className="text-sm text-fg-muted bg-transparent outline-none w-full mt-1"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-1.5 text-sm text-fg-muted mr-1">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              Shared
            </label>
            <button onClick={runPreview} disabled={running} className="px-3 py-2 text-sm font-medium rounded-lg border border-line text-fg-muted bg-surface inline-flex items-center gap-1.5 disabled:opacity-50">
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run preview
            </button>
            <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-lg text-white inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: ACCENT }}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {reportId ? "Save changes" : "Save report"}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-danger-bg border border-danger-border text-danger rounded-lg text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Config */}
        <div className="space-y-4">
          <div className="card">
            <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">Data source</label>
            <select value={sourceKey} onChange={(e) => { const s = sources.find((x) => x.key === e.target.value); if (s) selectSource(s); }} className={inputCls}>
              {sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          {source && (
            <div className="card">
              <div className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2">Columns</div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {source.columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-sm text-fg">
                    <input type="checkbox" checked={columns.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {source && (
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">Filters</span>
                <button onClick={() => setFilters((f) => [...f, { field: source.columns[0].key, op: "contains", value: "" }])} className="text-xs text-accent-text font-medium inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              {filters.length === 0 && <p className="text-xs text-fg-muted">No filters.</p>}
              <div className="space-y-2">
                {filters.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <select value={f.field} onChange={(e) => setFilters((cur) => cur.map((x, j) => j === i ? { ...x, field: e.target.value } : x))} className="px-2 py-1.5 rounded-lg border border-line text-xs bg-surface flex-1 min-w-0">
                      {source.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <select value={f.op} onChange={(e) => setFilters((cur) => cur.map((x, j) => j === i ? { ...x, op: e.target.value as "eq" | "contains" } : x))} className="px-2 py-1.5 rounded-lg border border-line text-xs bg-surface">
                      <option value="contains">contains</option>
                      <option value="eq">equals</option>
                    </select>
                    <input value={f.value} onChange={(e) => setFilters((cur) => cur.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" className="px-2 py-1.5 rounded-lg border border-line text-xs bg-surface flex-1 min-w-0" />
                    <button onClick={() => setFilters((cur) => cur.filter((_, j) => j !== i))} className="text-fg-muted hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {source && (
            <div className="card space-y-3">
              <div>
                <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">Date range ({source.columns.find((c) => c.key === source.dateField)?.label ?? source.dateField})</label>
                <div className="flex items-center gap-2">
                  <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1.5 rounded-lg border border-line text-xs bg-surface flex-1" />
                  <span className="text-xs text-fg-muted">to</span>
                  <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="px-2 py-1.5 rounded-lg border border-line text-xs bg-surface flex-1" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">Group by</label>
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={inputCls}>
                  <option value="">No grouping (rows)</option>
                  {source.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">Visualization</label>
                <select value={visualization} onChange={(e) => setVisualization(e.target.value as Visualization)} className={inputCls}>
                  {VISUALIZATIONS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                </select>
                {visualization !== "table" && visualization !== "number" && !groupBy && (
                  <p className="text-[11px] text-warn mt-1">Charts need a “Group by” field.</p>
                )}
              </div>
              {!groupBy && (
                <div>
                  <label className="block text-xs font-semibold text-fg-muted uppercase tracking-wider mb-1.5">Sort by</label>
                  <div className="flex items-center gap-2">
                    <select value={sortField} onChange={(e) => setSortField(e.target.value)} className="px-2 py-1.5 rounded-lg border border-line text-xs bg-surface flex-1">
                      <option value="">Default ({source.dateField})</option>
                      {source.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <select value={sortDir} onChange={(e) => setSortDir(e.target.value as "asc" | "desc")} className="px-2 py-1.5 rounded-lg border border-line text-xs bg-surface">
                      <option value="desc">Desc</option>
                      <option value="asc">Asc</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="card-title">Preview</h3>
              {preview && <span className="text-xs text-fg-muted">{preview.grouped ? `${preview.total} groups` : `${preview.total} rows`}</span>}
            </div>
            {!preview ? (
              <p className="text-sm text-fg-muted py-8 text-center">Run a preview to see results.</p>
            ) : (
              <ReportResultView result={preview} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
