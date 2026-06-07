"use client";

import { TableEmpty } from "../ds";

// Renders the output of a report run (E-16) — either a plain row table or a
// grouped aggregate table. Used by both the builder preview and the saved-report
// view so they look identical. Tables use the shared `.table-wrap`/`.data-table`
// design-system classes (E-13).

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

export function ReportResultTable({ result }: { result: RunResult }) {
  // Grouped aggregate view.
  if (result.grouped) {
    const hasSum = result.grouped.some((g) => g.sum !== null);
    const cols = hasSum ? 3 : 2;
    return (
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr>
            <th>Group</th>
            <th>Count</th>
            {hasSum && <th>Total</th>}
          </tr></thead>
          <tbody>
            {result.grouped.length === 0 ? (
              <TableEmpty colSpan={cols} title="No data in the selected window" description="Widen the date range or adjust filters." icon="📊" />
            ) : result.grouped.map((g, i) => (
              <tr key={i}>
                <td>{g.group || "—"}</td>
                <td>{g.count.toLocaleString("en-IN")}</td>
                {hasSum && <td>{(g.sum ?? 0).toLocaleString("en-IN")}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Plain row view.
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr>{result.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {result.rows.length === 0 ? (
            <TableEmpty colSpan={Math.max(1, result.columns.length)} title="No rows match this report" description="Try removing a filter or widening the date range." />
          ) : result.rows.map((row, i) => (
            <tr key={(row.id as string) ?? i}>
              {result.columns.map((c) => <td key={c.key}>{fmt(row[c.key], c.type)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
