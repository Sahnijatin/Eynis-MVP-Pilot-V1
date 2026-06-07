"use client";

// Renders the output of a report run (E-16) — either a plain row table or a
// grouped aggregate table. Used by both the builder preview and the saved-report
// view so they look identical.

export interface RRColumn { key: string; label: string; type: string }
export interface RunResult {
  ok: true;
  source: string;
  visualization: string;
  columns: RRColumn[];
  rows: Array<Record<string, unknown>>;
  grouped: Array<{ group: string; count: number; sum: number | null }> | null;
  total: number;
  name?: string;
}

function fmt(value: unknown, type: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "date") {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  if (type === "number") return typeof value === "number" ? value.toLocaleString("en-IN") : String(value);
  return String(value);
}

const th = "px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100";
const td = "px-3 py-2 text-sm text-slate-700 border-b border-slate-50 align-top";

export function ReportResultTable({ result }: { result: RunResult }) {
  // Grouped aggregate view.
  if (result.grouped) {
    const hasSum = result.grouped.some((g) => g.sum !== null);
    if (result.grouped.length === 0) {
      return <p className="text-sm text-slate-400 p-4">No data in the selected window.</p>;
    }
    return (
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full">
          <thead><tr>
            <th className={th}>Group</th>
            <th className={th}>Count</th>
            {hasSum && <th className={th}>Total</th>}
          </tr></thead>
          <tbody>
            {result.grouped.map((g, i) => (
              <tr key={i}>
                <td className={td}>{g.group || "—"}</td>
                <td className={td}>{g.count.toLocaleString("en-IN")}</td>
                {hasSum && <td className={td}>{(g.sum ?? 0).toLocaleString("en-IN")}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Plain row view.
  if (result.rows.length === 0) {
    return <p className="text-sm text-slate-400 p-4">No rows match this report.</p>;
  }
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full">
        <thead><tr>{result.columns.map((c) => <th key={c.key} className={th}>{c.label}</th>)}</tr></thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={(row.id as string) ?? i}>
              {result.columns.map((c) => <td key={c.key} className={td}>{fmt(row[c.key], c.type)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
