"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseCSV } from "../../lib/csv";

// Eynis fields a CSV column can map to. Everything unmapped is still preserved in
// rawData on the server for {lead.custom.*}.
const EYNIS_FIELDS = ["firstName", "lastName", "phone", "email", "company", "jobTitle", "consent"] as const;
type EynisField = (typeof EYNIS_FIELDS)[number];
const FIELD_LABEL: Record<EynisField, string> = {
  firstName: "First name *", lastName: "Last name", phone: "Phone *", email: "Email",
  company: "Company", jobTitle: "Job title", consent: "Consent column",
};
const SYNONYMS: Record<EynisField, string[]> = {
  firstName: ["first", "fname", "name", "firstname"], lastName: ["last", "lname", "surname", "lastname"],
  phone: ["phone", "mobile", "number", "contact", "whatsapp", "cell"], email: ["email", "mail"],
  company: ["company", "organisation", "organization", "org", "account"], jobTitle: ["title", "role", "designation", "position"],
  consent: ["consent", "opt", "opted", "subscribe"],
};
const CONSENT_SOURCES = ["csv_import", "web_form", "api", "verbal", "double_opt_in"];

function autoMap(headers: string[]): Record<EynisField, string> {
  const m = {} as Record<EynisField, string>;
  for (const f of EYNIS_FIELDS) {
    const hit = headers.find((h) => SYNONYMS[f].some((s) => h.toLowerCase().includes(s)));
    m[f] = hit ?? "";
  }
  return m;
}

export function LeadImportWizard({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<EynisField, string>>({} as Record<EynisField, string>);
  const [defaultConsent, setDefaultConsent] = useState(false);
  const [consentSource, setConsentSource] = useState("csv_import");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: Array<{ row: number; reason: string }> } | null>(null);

  async function onFile(f: File | undefined) {
    setError(null); setResult(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) { setError("Only .csv files are supported"); return; }
    setFile(f);
    // Parse only the first 64KB for headers + a small preview — keeps the browser
    // responsive even for very large files; the full file is uploaded for import.
    const text = await f.slice(0, 65536).text();
    const rows = parseCSV(text).filter((r) => r.some((c) => c.trim() !== ""));
    const hdrs = rows[0] ?? [];
    setHeaders(hdrs);
    setSample(rows.slice(1, 6));
    setMapping(autoMap(hdrs));
  }

  async function doImport() {
    setError(null);
    if (!file) { setError("Choose a CSV file"); return; }
    if (!mapping.firstName || !mapping.phone) { setError("Map at least First name and Phone"); return; }
    if (!mapping.consent && !defaultConsent) { setError("Map a consent column, or confirm the whole list has opted in"); return; }

    // API expects columnMap as { csvHeader: eynisField }.
    const columnMap: Record<string, string> = {};
    for (const f of EYNIS_FIELDS) if (mapping[f]) columnMap[mapping[f]] = f;

    const fd = new FormData();
    fd.append("file", file);
    fd.append("columnMap", JSON.stringify(columnMap));
    if (defaultConsent) { fd.append("defaultConsent", "true"); fd.append("consentSource", consentSource); }

    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/leads/import`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Import failed"); return; }
      setResult({ imported: data.imported, skipped: data.skipped, errors: data.errors ?? [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <Link href={`/campaigns/${campaignId}`} style={{ color: "#0f766e", fontSize: 14 }}>← Back to campaign</Link>
      <h1 style={{ margin: "8px 0 20px", fontSize: 24 }}>Import leads</h1>

      <section style={section}>
        <div style={sectionTitle}>1. Upload CSV</div>
        <input ref={fileRef} type="file" accept=".csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} style={btnGhost}>{file ? `Change file (${file.name})` : "Choose CSV file"}</button>
        {file && <span style={{ marginLeft: 10, color: "#666", fontSize: 13 }}>{(file.size / 1024).toFixed(0)} KB</span>}
      </section>

      {headers.length > 0 && (
        <>
          <section style={section}>
            <div style={sectionTitle}>2. Map columns</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {EYNIS_FIELDS.map((f) => (
                <div key={f}>
                  <label style={lbl}>{FIELD_LABEL[f]}</label>
                  <select value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })} style={input}>
                    <option value="">— none —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, padding: 12, background: "#fafafa", borderRadius: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={defaultConsent} onChange={(e) => setDefaultConsent(e.target.checked)} />
                I confirm every contact in this file has consented to be contacted
              </label>
              {defaultConsent && (
                <div style={{ marginTop: 8 }}>
                  <label style={lbl}>Consent source</label>
                  <select value={consentSource} onChange={(e) => setConsentSource(e.target.value)} style={{ ...input, maxWidth: 240 }}>
                    {CONSENT_SOURCES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <p style={{ fontSize: 12, color: "#888", margin: "8px 0 0" }}>
                Leads without consent are rejected. Opted-out numbers are skipped automatically.
              </p>
            </div>
          </section>

          <section style={section}>
            <div style={sectionTitle}>3. Preview (first {sample.length} rows)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
                <thead><tr>{headers.map((h) => <th key={h} style={{ ...th, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {sample.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f3f4f6" }}>{headers.map((_, j) => <td key={j} style={td}>{r[j] ?? ""}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {error && <div style={{ color: "#991b1b", background: "#fee2e2", padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}
          {!result && (
            <button onClick={doImport} disabled={busy} style={btnPrimary}>{busy ? "Importing…" : "Import leads"}</button>
          )}
        </>
      )}

      {result && (
        <section style={{ ...section, borderColor: "#0f766e" }}>
          <div style={sectionTitle}>Import complete</div>
          <div style={{ display: "flex", gap: 24, marginBottom: 12 }}>
            <div><div style={{ fontSize: 28, fontWeight: 700, color: "#166534" }}>{result.imported}</div><div style={{ color: "#666", fontSize: 13 }}>imported</div></div>
            <div><div style={{ fontSize: 28, fontWeight: 700, color: "#92400e" }}>{result.skipped}</div><div style={{ color: "#666", fontSize: 13 }}>skipped (dupes / opted-out)</div></div>
            <div><div style={{ fontSize: 28, fontWeight: 700, color: "#991b1b" }}>{result.errors.length}</div><div style={{ color: "#666", fontSize: 13 }}>rejected</div></div>
          </div>
          {result.errors.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "#666" }}>View rejected rows</summary>
              <ul style={{ fontSize: 13, color: "#666", maxHeight: 160, overflow: "auto" }}>
                {result.errors.slice(0, 100).map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
              </ul>
            </details>
          )}
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <Link href={`/campaigns/${campaignId}`} style={btnPrimary}>View campaign</Link>
            <button onClick={() => { setResult(null); setFile(null); setHeaders([]); }} style={btnGhost}>Import another file</button>
          </div>
        </section>
      )}
    </div>
  );
}

const section: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", padding: 18, marginBottom: 16 };
const sectionTitle: React.CSSProperties = { fontWeight: 600, marginBottom: 12, fontSize: 15 };
const lbl: React.CSSProperties = { display: "block", fontSize: 13, color: "#374151", marginBottom: 4, fontWeight: 500 };
const input: React.CSSProperties = { width: "100%", padding: "9px 10px", border: "1px solid #d1d5db", borderRadius: 7, fontSize: 14, boxSizing: "border-box" };
const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, textAlign: "left", color: "#666", background: "#fafafa" };
const td: React.CSSProperties = { padding: "8px 10px", whiteSpace: "nowrap" };
const btnPrimary: React.CSSProperties = { background: "#0f766e", color: "#fff", padding: "10px 18px", borderRadius: 8, fontWeight: 600, border: "none", cursor: "pointer", fontSize: 14, textDecoration: "none" };
const btnGhost: React.CSSProperties = { background: "#f3f4f6", color: "#374151", padding: "10px 18px", borderRadius: 8, fontWeight: 600, textDecoration: "none", border: "none", cursor: "pointer", fontSize: 14 };
