// Branded, print-optimised HTML report (E-9). Served inline (text/html) so the
// browser renders it and the user saves it as PDF (Ctrl/Cmd-P → Save as PDF). A
// dependency-free "PDF export" — no PDF library, no native binaries. The document
// is fully self-contained (inline CSS) and carries the tenant's brand header +
// support contact, with a "powered by" footer dropped for white_label tenants.

import type { ReportBrand } from "./brand";

export type ReportBlock =
  | { kind: "headline"; text: string; score?: number }
  | { kind: "section"; heading: string; body: string }
  | { kind: "list"; heading: string; items: string[] }
  | { kind: "table"; heading?: string; header: string[]; rows: Array<Array<string | number>> };

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderBlock(b: ReportBlock): string {
  if (b.kind === "headline") {
    const score = typeof b.score === "number"
      ? `<div class="score"><span>${esc(b.score)}</span><small>/ 10</small></div>` : "";
    return `<div class="headline"><div class="headline-text">${esc(b.text)}</div>${score}</div>`;
  }
  if (b.kind === "list") {
    const items = b.items.length
      ? `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
      : `<p class="muted">None.</p>`;
    return `<section><h2>${esc(b.heading)}</h2>${items}</section>`;
  }
  if (b.kind === "table") {
    const head = `<tr>${b.header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
    const body = b.rows.length
      ? b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${b.header.length}" class="muted">No rows.</td></tr>`;
    const heading = b.heading ? `<h2>${esc(b.heading)}</h2>` : "";
    return `<section>${heading}<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table></section>`;
  }
  return `<section><h2>${esc(b.heading)}</h2><p>${esc(b.body)}</p></section>`;
}

export function renderBrandedReportHtml(
  brand: ReportBrand,
  opts: { title: string; subtitle?: string; generatedAt?: Date; blocks: ReportBlock[] }
): string {
  const generated = (opts.generatedAt ?? new Date()).toLocaleString("en-IN");
  const logo = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.brandName)}" class="logo" />`
    : `<span class="logo-text">${esc(brand.brandName.charAt(0).toUpperCase())}</span>`;
  const support = brand.supportEmail
    ? `<a href="mailto:${esc(brand.supportEmail)}">${esc(brand.supportEmail)}</a>` : "";
  const footer = brand.showPoweredBy ? `Powered by ${esc(brand.platformName)}` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(brand.brandName)} — ${esc(opts.title)}</title>
<style>
  :root { --brand: ${esc(brand.primaryColor)}; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f1f5f9; color: #0f172a;
    font-family: Inter, system-ui, "Segoe UI", Arial, sans-serif; }
  .sheet { max-width: 800px; margin: 24px auto; background: #fff; border-radius: 12px; overflow: hidden; }
  .brandbar { display: flex; align-items: center; gap: 12px; padding: 20px 28px; background: var(--brand); color: #fff; }
  .logo { height: 36px; max-width: 200px; object-fit: contain; }
  .logo-text { width: 36px; height: 36px; border-radius: 8px; background: rgba(255,255,255,.2);
    display: inline-flex; align-items: center; justify-content: center; font-weight: 700; }
  .brandbar .name { font-size: 18px; font-weight: 700; }
  .meta { padding: 12px 28px; color: #64748b; font-size: 12px; border-bottom: 1px solid #e2e8f0;
    display: flex; gap: 16px; flex-wrap: wrap; }
  .body { padding: 24px 28px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: #475569; margin: 20px 0 8px; }
  .headline { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; }
  .headline-text { font-size: 16px; font-weight: 600; }
  .score { text-align: center; flex-shrink: 0; }
  .score span { font-size: 32px; font-weight: 800; color: var(--brand); }
  .score small { display: block; color: #94a3b8; }
  ul { margin: 0; padding-left: 18px; } li { margin: 4px 0; }
  table.data { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.data th { text-align: left; padding: 8px 10px; background: #f8fafc; color: #475569;
    border-bottom: 1px solid #e2e8f0; text-transform: none; letter-spacing: 0; font-size: 11px; }
  table.data td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; color: #0f172a; vertical-align: top; }
  p { line-height: 1.6; } .muted { color: #94a3b8; }
  .foot { padding: 16px 28px; color: #94a3b8; font-size: 12px; text-align: center; }
  .toolbar { max-width: 800px; margin: 16px auto -8px; text-align: right; }
  .toolbar button { background: var(--brand); color: #fff; border: 0; border-radius: 8px;
    padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
  @media print { body { background: #fff; } .sheet { margin: 0; border-radius: 0; } .toolbar { display: none; } }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">Save as PDF</button></div>
  <div class="sheet">
    <div class="brandbar">${logo}<span class="name">${esc(brand.brandName)}</span></div>
    <div class="meta">
      <span><strong>${esc(opts.title)}</strong></span>
      ${opts.subtitle ? `<span>${esc(opts.subtitle)}</span>` : ""}
      <span>Generated ${esc(generated)}</span>
      ${support ? `<span>Support: ${support}</span>` : ""}
    </div>
    <div class="body">
      <h1>${esc(opts.title)}</h1>
      ${opts.blocks.map(renderBlock).join("\n")}
    </div>
    ${footer ? `<div class="foot">${footer}</div>` : ""}
  </div>
</body></html>`;
}
