"use client";

// Reusable CSV import with field mapping (E-4). The user picks a CSV file, maps
// each target field to a CSV column (auto-guessed by header name), previews the
// row count, then imports. The actual persistence is delegated to `onImport` so
// each entity can POST to its own endpoint.

import { useMemo, useState } from "react";
import { Button, Field, Select, Modal, Spinner, useToast, tokens as t } from "../ds";
import { parseCSV } from "../../lib/csv";

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
}

export interface ImportResult {
  created: number;
  failed: number;
  errors?: string[];
}

function guessColumn(headers: string[], field: ImportField): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(field.label);
  const key = norm(field.key);
  const idx = headers.findIndex((h) => { const n = norm(h); return n === target || n === key; });
  if (idx >= 0) return idx;
  return headers.findIndex((h) => { const n = norm(h); return n.includes(key) || key.includes(n); });
}

export function CsvImportModal({
  title, fields, onImport, onClose,
}: {
  title: string;
  fields: ImportField[];
  onImport: (records: Record<string, string>[]) => Promise<ImportResult>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File) {
    setError(null); setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const rows = parseCSV(text).filter((r) => r.some((c) => c.trim() !== ""));
      if (rows.length < 2) { setError("That file has no data rows."); return; }
      const hdr = rows[0];
      setHeaders(hdr);
      setDataRows(rows.slice(1));
      const initial: Record<string, number> = {};
      for (const f of fields) { const g = guessColumn(hdr, f); if (g >= 0) initial[f.key] = g; }
      setMapping(initial);
    };
    reader.readAsText(file);
  }

  const missingRequired = useMemo(
    () => fields.filter((f) => f.required && (mapping[f.key] == null || mapping[f.key] < 0)).map((f) => f.label),
    [fields, mapping],
  );

  async function runImport() {
    if (missingRequired.length > 0) { setError(`Map required field(s): ${missingRequired.join(", ")}`); return; }
    setBusy(true); setError(null);
    try {
      const records = dataRows.map((r) => {
        const rec: Record<string, string> = {};
        for (const f of fields) { const idx = mapping[f.key]; if (idx != null && idx >= 0) rec[f.key] = (r[idx] ?? "").trim(); }
        return rec;
      }).filter((rec) => Object.values(rec).some((v) => v !== ""));
      const res = await onImport(records);
      setResult(res);
      if (res.created > 0) toast.push(`Imported ${res.created} row(s)`, "success");
      if (res.created > 0 && res.failed === 0) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={560}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={runImport} disabled={busy || dataRows.length === 0}>{busy ? <Spinner size={14} /> : `Import ${dataRows.length || ""} row(s)`}</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="CSV file" hint="First row must be column headers. Exporting to CSV from Excel/Sheets works.">
          <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </Field>

        {headers.length > 0 && (
          <div>
            <div style={{ fontSize: t.font.xs, fontWeight: 700, textTransform: "uppercase", color: t.color.textMuted, marginBottom: 8 }}>
              Map columns — {dataRows.length} row(s) detected
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {fields.map((f) => (
                <div key={f.key} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: t.font.sm, color: t.color.text }}>{f.label}{f.required ? <span style={{ color: t.color.danger }}> *</span> : ""}</span>
                  <Select value={mapping[f.key] ?? -1} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}>
                    <option value={-1}>— skip —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div style={{ fontSize: t.font.sm, color: t.color.text }}>
            Imported <strong>{result.created}</strong>, failed <strong>{result.failed}</strong>.
            {result.errors && result.errors.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: t.color.danger, fontSize: t.font.xs }}>
                {result.errors.slice(0, 5).map((er, i) => <li key={i}>{er}</li>)}
              </ul>
            )}
          </div>
        )}
        {error && <div style={{ color: t.color.danger, fontSize: t.font.sm }}>{error}</div>}
      </div>
    </Modal>
  );
}
