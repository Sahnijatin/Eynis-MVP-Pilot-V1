"use client";

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { ReportResultTable, type RunResult } from "./report-result-table";

// Renders a report run as the chosen visualization (E-16 Phase B). Charts need
// grouped data (group-by); if a chart viz is selected without grouping we fall
// back to the table so the user always sees their data.

const PALETTE = ["#0f766e", "#14b8a6", "#f59e0b", "#6366f1", "#ef4444", "#8b5cf6", "#0891b2", "#65a30d", "#db2777", "#475569"];

interface Datum { label: string; value: number }

function toData(result: RunResult): Datum[] {
  if (!result.grouped) return [];
  // Prefer the metric sum when present, else the row count.
  const useSum = result.grouped.some((g) => g.sum !== null);
  return result.grouped.map((g) => ({ label: g.group || "—", value: useSum ? (g.sum ?? 0) : g.count }));
}

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 } as const;

export function ReportResultView({ result }: { result: RunResult }) {
  const viz = result.visualization ?? "table";

  // Single number — total matching records (or summed group counts).
  if (viz === "number") {
    const total = result.grouped ? result.grouped.reduce((s, g) => s + g.count, 0) : result.total;
    return (
      <div className="py-10 text-center">
        <div className="text-5xl font-black" style={{ color: "var(--color-primary, #0f766e)" }}>{total.toLocaleString("en-IN")}</div>
        <div className="text-sm text-fg-muted mt-2">total records</div>
      </div>
    );
  }

  // Charts require grouped data.
  if (viz === "bar" || viz === "line" || viz === "pie") {
    const data = toData(result);
    if (data.length === 0) {
      return (
        <div>
          <p className="text-sm text-warn bg-warn-bg border border-warn-border rounded-lg px-3 py-2 mb-3">
            Charts need a “Group by” field — showing the table instead.
          </p>
          <ReportResultTable result={result} />
        </div>
      );
    }
    return (
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          {viz === "bar" ? (
            <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" fill="#0f766e" radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : viz === "line" ? (
            <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="value" stroke="#0f766e" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          ) : (
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={110} label>
                {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }

  // Default: table.
  return <ReportResultTable result={result} />;
}
