"use client";

import { useRef, useState } from "react";
import { Download, Upload, CheckCircle, AlertCircle, X } from "lucide-react";
import { escapeCSV, parseCSV } from "../../lib/csv";

// Reusable CSV import/export button pair. Used on every list page that needs
// data I/O (customers, guests, patients, bookings, orders, quotes, materials,
// inventory, menu, appointments). Export builds a CSV from the rows you pass
// in. Import opens a file picker, parses the CSV in the browser, and hands
// each row back to the parent via onImport — the parent decides whether to
// POST to the API or just append locally.

export interface ImportExportColumn<T> {
  label: string;
  // Either a property key on T, or a function that returns the cell value.
  value: keyof T | ((row: T) => string | number | null | undefined);
}

interface Props<T> {
  rows: T[];
  columns: ImportExportColumn<T>[];
  // The CSV file name (no extension required).
  fileBase: string;
  // Optional accent for the buttons. Defaults to a neutral slate.
  accentColor?: string;
  // Called once the CSV is parsed. Receives the headers and the raw rows
  // (as string arrays). Returning a count makes the toast read better.
  onImport?: (rows: Record<string, string>[]) => { count: number } | Promise<{ count: number }>;
  // Set to true to hide the Import button (useful for read-only logs).
  exportOnly?: boolean;
}

type Toast = { type: "success"; message: string } | { type: "error"; message: string } | null;

export function ImportExportButtons<T>({
  rows,
  columns,
  fileBase,
  accentColor = "#475569",
  onImport,
  exportOnly,
}: Props<T>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<Toast>(null);

  function flash(t: NonNullable<Toast>) {
    setToast(t);
    setTimeout(() => setToast(null), 4000);
  }

  function handleExport() {
    const header = columns.map(c => escapeCSV(c.label)).join(",");
    const lines = rows.map(row =>
      columns
        .map(c => {
          const v = typeof c.value === "function" ? c.value(row) : (row as Record<string, unknown>)[c.value as string];
          return escapeCSV(v);
        })
        .join(",")
    );
    const csv = [header, ...lines].join("\n");
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBase}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    flash({ type: "success", message: `Exported ${rows.length} row${rows.length === 1 ? "" : "s"} to ${a.download}` });
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      flash({ type: "error", message: "Only .csv files are supported" });
      return;
    }
    try {
      const text = await file.text();
      const grid = parseCSV(text).filter(r => r.some(c => c.trim() !== ""));
      if (grid.length < 2) { flash({ type: "error", message: "CSV has no data rows" }); return; }
      const headers = grid[0].map(h => h.trim());
      const parsed = grid.slice(1).map(cells => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
        return obj;
      });
      if (onImport) {
        const result = await onImport(parsed);
        // A handler may return nothing; fall back to the parsed row count so the
        // success toast never throws on `result.count`.
        const count = result?.count ?? parsed.length;
        flash({ type: "success", message: `Imported ${count} row${count === 1 ? "" : "s"}` });
      } else {
        flash({ type: "success", message: `Parsed ${parsed.length} row${parsed.length === 1 ? "" : "s"} (import handler not wired)` });
      }
    } catch {
      flash({ type: "error", message: "Failed to parse CSV" });
    }
  }

  return (
    <div className="inline-flex items-center gap-2 relative">
      {!exportOnly && (
        <>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleImport} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" /> Import
          </button>
        </>
      )}
      <button
        type="button"
        onClick={handleExport}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
        style={{ color: accentColor }}
      >
        <Download className="w-3.5 h-3.5" /> Export
      </button>

      {toast && (
        <div className={`absolute right-0 top-12 z-50 min-w-[260px] max-w-sm px-3 py-2 rounded-lg shadow-lg flex items-start gap-2 border ${toast.type === "success" ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          {toast.type === "success" ? <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />}
          <span className={`text-xs ${toast.type === "success" ? "text-emerald-700" : "text-red-600"} flex-1`}>{toast.message}</span>
          <button onClick={() => setToast(null)} className="text-slate-500 hover:text-slate-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
