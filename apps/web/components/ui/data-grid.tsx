"use client";

// Reusable spreadsheet-style data grid for the CRM (E-4). Hand-rolled on the
// existing design-system primitives (the codebase has no table lib and uses
// inline-styled DS components everywhere) rather than pulling in TanStack/shadcn,
// so it stays visually consistent and dependency-free. Features:
//   • column sort (click header to cycle asc → desc → none)
//   • per-column filter (text contains / select equals) + global search
//   • inline cell editing (text / number / date / select) where a column is editable
//   • column chooser (show/hide), persisted per-grid in localStorage
//   • row selection + bulk delete
//   • CSV export of the current (filtered + sorted) view
// The table scrolls horizontally on small screens so it stays usable on mobile.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select, EmptyState, useToast, tokens as t } from "../ds";
import { escapeCSV } from "../../lib/csv";

export type GridColumnType = "text" | "number" | "date" | "select";

export interface GridColumn<T> {
  key: string;
  header: string;
  // Raw value used for sorting, filtering and CSV export (typically the display value).
  accessor?: (row: T) => string | number | null | undefined;
  // Stored value to seed inline editing when it differs from the display value
  // (e.g. an owner column shows the name but edits the ownerId). Defaults to accessor.
  editAccessor?: (row: T) => string;
  // Custom display in read mode (defaults to the accessor value).
  render?: (row: T) => React.ReactNode;
  type?: GridColumnType;
  editable?: boolean;
  options?: Array<{ value: string; label: string }>;
  width?: number;
  filterable?: boolean;
  sortable?: boolean;
  align?: "left" | "right";
  defaultHidden?: boolean;
}

export interface DataGridProps<T> {
  rows: T[];
  columns: GridColumn<T>[];
  getId: (row: T) => string;
  storageKey: string;
  exportFilename: string;
  onEditCell?: (row: T, key: string, value: string) => Promise<void> | void;
  onDeleteRows?: (rows: T[]) => Promise<void> | void;
  onRowOpen?: (row: T) => void;
  toolbarRight?: React.ReactNode;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

type SortState = { key: string; dir: "asc" | "desc" } | null;

function rawString(v: string | number | null | undefined): string {
  return v == null ? "" : String(v);
}

export function DataGrid<T>({
  rows, columns, getId, storageKey, exportFilename,
  onEditCell, onDeleteRows, onRowOpen, toolbarRight,
  searchPlaceholder = "Search…", emptyTitle = "Nothing here yet", emptyDescription,
}: DataGridProps<T>) {
  const toast = useToast();

  // Local copy so inline edits feel instant; re-syncs when the server sends new rows.
  const [data, setData] = useState<T[]>(rows);
  useEffect(() => setData(rows), [rows]);

  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);

  // Column visibility (persisted). Stored value is the list of *hidden* keys.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    let initial = new Set<string>(columns.filter((c) => c.defaultHidden).map((c) => c.key));
    try {
      const saved = localStorage.getItem("datagrid:" + storageKey);
      if (saved) initial = new Set<string>(JSON.parse(saved));
    } catch { /* ignore corrupt prefs */ }
    setHidden(initial);
  }, [storageKey, columns]);

  function persistHidden(next: Set<string>) {
    setHidden(next);
    try { localStorage.setItem("datagrid:" + storageKey, JSON.stringify([...next])); } catch { /* quota */ }
  }

  useEffect(() => {
    if (!colMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setColMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [colMenuOpen]);

  const visibleColumns = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);

  const valueOf = (row: T, col: GridColumn<T>): string | number | null | undefined =>
    col.accessor ? col.accessor(row) : undefined;

  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = data.filter((row) => {
      if (q) {
        const hit = columns.some((c) => rawString(valueOf(row, c)).toLowerCase().includes(q));
        if (!hit) return false;
      }
      for (const c of columns) {
        const f = filters[c.key];
        if (!f) continue;
        const cell = rawString(valueOf(row, c)).toLowerCase();
        if (c.type === "select") { if (cell !== f.toLowerCase()) return false; }
        else if (!cell.includes(f.toLowerCase())) return false;
      }
      return true;
    });
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const av = valueOf(a, col), bv = valueOf(b, col);
          let cmp: number;
          if (col.type === "number") cmp = (Number(av) || 0) - (Number(bv) || 0);
          else if (col.type === "date") cmp = new Date(rawString(av) || 0).getTime() - new Date(rawString(bv) || 0).getTime();
          else cmp = rawString(av).localeCompare(rawString(bv), undefined, { numeric: true });
          return sort.dir === "asc" ? cmp : -cmp;
        });
      }
    }
    return out;
  }, [data, columns, filters, search, sort]);

  function toggleSort(key: string) {
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  }

  function startEdit(row: T, col: GridColumn<T>) {
    if (!col.editable || !onEditCell) return;
    setEditing({ id: getId(row), key: col.key });
    setDraft(col.editAccessor ? col.editAccessor(row) : rawString(valueOf(row, col)));
  }

  async function commitEdit(row: T, col: GridColumn<T>) {
    const prevVal = col.editAccessor ? col.editAccessor(row) : rawString(valueOf(row, col));
    setEditing(null);
    if (draft === prevVal) return;
    // Optimistic: nothing to mutate locally (accessor reads row fields we don't own),
    // so we just call the parent and let it refresh; show a toast on failure.
    try {
      await onEditCell?.(row, col.key, draft);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Update failed", "error");
    }
  }

  function exportCsv() {
    const cols = visibleColumns;
    const header = cols.map((c) => escapeCSV(c.header)).join(",");
    const lines = view.map((row) => cols.map((c) => escapeCSV(valueOf(row, c))).join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = exportFilename.endsWith(".csv") ? exportFilename : exportFilename + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const allVisibleSelected = view.length > 0 && view.every((r) => selected.has(getId(r)));
  function toggleSelectAll() {
    setSelected((prev) => {
      if (allVisibleSelected) { const n = new Set(prev); view.forEach((r) => n.delete(getId(r))); return n; }
      const n = new Set(prev); view.forEach((r) => n.add(getId(r))); return n;
    });
  }
  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function deleteSelected() {
    if (!onDeleteRows) return;
    const targets = data.filter((r) => selected.has(getId(r)));
    if (targets.length === 0) return;
    if (!confirm(`Delete ${targets.length} selected row(s)? This cannot be undone.`)) return;
    try {
      await onDeleteRows(targets);
      setSelected(new Set());
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Delete failed", "error");
    }
  }

  const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", fontSize: t.font.xs, fontWeight: 700, color: t.color.textMuted, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", borderBottom: `1px solid ${t.color.border}`, background: t.color.surfaceMuted, position: "sticky", top: 0 };
  const td: React.CSSProperties = { padding: "8px 10px", fontSize: t.font.sm, color: t.color.text, borderBottom: `1px solid ${t.color.border}`, whiteSpace: "nowrap" };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <Input placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260 }} />
        {selected.size > 0 && onDeleteRows && (
          <Button variant="danger" size="sm" onClick={deleteSelected}>Delete {selected.size}</Button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: t.font.sm, color: t.color.textMuted }}>{view.length} of {data.length}</span>
          {/* Column chooser */}
          <div style={{ position: "relative" }} ref={colMenuRef}>
            <Button variant="secondary" size="sm" onClick={() => setColMenuOpen((o) => !o)}>Columns</Button>
            {colMenuOpen && (
              <div style={{ position: "absolute", right: 0, top: "110%", zIndex: 50, background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, boxShadow: t.shadow.lg, padding: 8, minWidth: 180, maxHeight: 320, overflow: "auto" }}>
                {columns.map((c) => (
                  <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", fontSize: t.font.sm, cursor: "pointer", color: t.color.text }}>
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => {
                      const n = new Set(hidden); n.has(c.key) ? n.delete(c.key) : n.add(c.key); persistHidden(n);
                    }} />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={exportCsv}>Export CSV</Button>
          {toolbarRight}
        </div>
      </div>

      {view.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} icon="📋" />
      ) : (
        <div style={{ overflowX: "auto", border: `1px solid ${t.color.border}`, borderRadius: t.radius.lg, background: t.color.surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 36 }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Select all" />
                </th>
                {visibleColumns.map((c) => {
                  const active = sort?.key === c.key;
                  return (
                    <th key={c.key} style={{ ...th, textAlign: c.align ?? "left", width: c.width, cursor: c.sortable === false ? "default" : "pointer" }}
                      onClick={() => c.sortable !== false && toggleSort(c.key)}>
                      {c.header}{active ? (sort!.dir === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  );
                })}
              </tr>
              {/* Per-column filter row */}
              <tr>
                <th style={{ ...th, background: t.color.surface, position: "static", padding: "4px 6px" }} />
                {visibleColumns.map((c) => (
                  <th key={c.key} style={{ ...th, background: t.color.surface, position: "static", padding: "4px 6px", fontWeight: 400 }}>
                    {c.filterable === false ? null : c.type === "select" ? (
                      <Select value={filters[c.key] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))} style={{ padding: "5px 8px", fontSize: t.font.xs }}>
                        <option value="">All</option>
                        {(c.options ?? []).map((o) => <option key={o.value} value={o.label}>{o.label}</option>)}
                      </Select>
                    ) : (
                      <Input value={filters[c.key] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))} placeholder="Filter" style={{ padding: "5px 8px", fontSize: t.font.xs }} />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((row) => {
                const id = getId(row);
                return (
                  <tr key={id} style={{ background: selected.has(id) ? t.color.accentSoft : undefined }}>
                    <td style={{ ...td, width: 36 }}>
                      <input type="checkbox" checked={selected.has(id)} onChange={() => toggleSelect(id)} aria-label="Select row" />
                    </td>
                    {visibleColumns.map((c) => {
                      const isEditing = editing?.id === id && editing.key === c.key;
                      const canEdit = c.editable && !!onEditCell;
                      return (
                        <td key={c.key} style={{ ...td, textAlign: c.align ?? "left", cursor: canEdit ? "text" : c.key === "__open" ? "pointer" : "default" }}
                          onClick={() => { if (!isEditing && canEdit) startEdit(row, c); }}>
                          {isEditing ? (
                            c.type === "select" ? (
                              <Select autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commitEdit(row, c)}
                                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(row, c); if (e.key === "Escape") setEditing(null); }}
                                style={{ padding: "4px 6px", fontSize: t.font.sm }}>
                                <option value="">—</option>
                                {(c.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </Select>
                            ) : (
                              <Input autoFocus type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
                                value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => commitEdit(row, c)}
                                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(row, c); if (e.key === "Escape") setEditing(null); }}
                                style={{ padding: "4px 6px", fontSize: t.font.sm }} />
                            )
                          ) : c.render ? (
                            <span onClick={c.key === "__open" && onRowOpen ? () => onRowOpen(row) : undefined}>{c.render(row)}</span>
                          ) : (
                            <span style={{ color: rawString(valueOf(row, c)) ? t.color.text : t.color.textFaint }}>
                              {rawString(valueOf(row, c)) || "—"}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
