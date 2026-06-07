// Dependency-free CSV generation for branded exports (E-9).

import type { ReportBrand } from "./brand";

// RFC-4180 quoting: wrap in quotes and double embedded quotes when the value
// contains a quote, comma, or newline. Everything is stringified first.
//
// Also guards against CSV/formula injection: a cell beginning with = + - @ (or a
// tab/CR) is interpreted as a formula by Excel/Sheets, and export data includes
// attacker-controllable text (e.g. WhatsApp-sourced request summaries). We prefix
// such cells with an apostrophe so they're treated as text. (OWASP CSV injection.)
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsvRows(rows: Array<Array<unknown>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// A branded CSV: a small title preamble (brand / title / generated / support)
// above the real table. The preamble rows are themselves valid CSV so the file
// still opens cleanly in a spreadsheet.
export function brandedCsv(
  brand: ReportBrand,
  title: string,
  table: { header: string[]; rows: Array<Array<unknown>> },
  generatedAt: Date = new Date()
): string {
  const preamble: Array<Array<unknown>> = [
    [`${brand.brandName} — ${title}`],
    ["Generated", generatedAt.toISOString()]
  ];
  if (brand.supportEmail) preamble.push(["Support", brand.supportEmail]);
  if (brand.showPoweredBy) preamble.push([`Powered by ${brand.platformName}`]);
  preamble.push([]); // blank separator row
  return toCsvRows([...preamble, table.header, ...table.rows]);
}
