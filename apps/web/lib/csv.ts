// Shared CSV helpers. Used by the reusable ImportExportButtons component and by
// the pages that still hand-roll their own import/export. Keeping one correct
// implementation here avoids the inconsistent, injection-prone copies that had
// drifted across the codebase.

// Escape a single cell for CSV output.
// - Neutralizes spreadsheet formula injection: a cell beginning with = + - @ (or a
//   leading tab/CR some apps strip) can execute as a formula in Excel/Sheets, so we
//   prefix a single quote to force text.
// - Quotes the cell when it contains a comma, quote, or newline, doubling any
//   embedded quotes per RFC 4180.
export function escapeCSV(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Parse an entire CSV document into rows of string cells. Handles quoted fields
// containing commas, escaped quotes (""), and newlines inside quotes.
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else { inQuotes = false; }
      } else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cur); cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++; // CRLF
      row.push(cur); cur = "";
      rows.push(row); row = [];
    } else {
      cur += ch;
    }
  }
  if (cur !== "" || row.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}

// Parse a single CSV line into cells. Quote-aware (handles quoted commas and
// escaped quotes) for pages that split a document into lines themselves.
export function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}
