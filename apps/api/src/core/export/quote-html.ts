// Customer-facing quotation as self-contained, print-ready HTML — the exact on-screen
// design, rendered to PDF through headless Chromium (see renderQuotationPdfHtml). This is
// the primary quotation document; the pdf-lib renderer (quote-pdf.ts) stays as the
// fallback when Chromium is unavailable.
//
// renderQuotationHtml is PURE (no I/O) and takes the SAME QuotationPdfData the pdf-lib
// renderer uses, so both stay in lock-step on the data. All dynamic text is HTML-escaped;
// all assets are inline data URLs and a strict CSP blocks any network fetch, so the page
// renders hermetically (no SSRF surface). Money is integer paise throughout.
//
// Pagination is natural: content fills each A4 page top-to-bottom and flows to the next
// page only when the current one is full — no forced single-page scaling, and no
// whole-section "break-inside: avoid" that would leave a page half-empty and push the tax
// summary / terms / signature onto page 2. Only small atomic units (a table row, the total
// card, the signature block, a single term) are kept from splitting across a page break.
import type { QuotationPdfData } from "./quote-pdf";
import { DEFAULT_TERMS } from "./quote-pdf";
import { gstStateName, amountInWords } from "../quotes/quotation";
import { launchPdfBrowser } from "./browser";

// ── small pure helpers ────────────────────────────────────────────────────────────
const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Indian digit grouping: 15340000 paise → "₹1,53,400.00".
const money = (paise: number): string =>
  `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: Date): string =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

// #rrggbb → {r,g,b}; falls back to the deep-maroon brand default on anything else.
function hexParts(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || "").trim());
  if (!m) return { r: 138, g: 30, b: 36 }; // #8a1e24
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
const rgbCss = ({ r, g, b }: { r: number; g: number; b: number }): string => `rgb(${r},${g},${b})`;
// Darken toward black by a factor (for the banner gradient's lower stop).
const darken = (p: { r: number; g: number; b: number }, f: number) =>
  ({ r: Math.round(p.r * f), g: Math.round(p.g * f), b: Math.round(p.b * f) });
// Relative luminance → pick a readable on-accent colour (near-white vs near-black).
const onAccent = (p: { r: number; g: number; b: number }): string =>
  (0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b) / 255 > 0.62 ? "#1b1d23" : "#fdf6f0";

// A trailing "unit" label goes muted next to the quantity.
const qtyCell = (n: number, unit: string): string =>
  `${esc(n)} <span class="u">${esc(unit || "unit")}</span>`;

// ── the template ───────────────────────────────────────────────────────────────────
export function renderQuotationHtml(data: QuotationPdfData): string {
  const v = data.view;
  const accent = hexParts(data.accentColor);
  const accentD = darken(accent, 0.8);
  const onAcc = onAccent(accent);
  const sellerName = data.seller.name || data.brandName || "Your Company";
  const logo = (data.logoUrl ?? "").trim();

  // Letterhead mark: the uploaded/hosted logo (already resolved to a data URL upstream)
  // sits in a white tile; with no logo, the accent tile shows the seller's initial.
  const markHtml = logo
    ? `<div class="mark mark-img"><img src="${esc(logo)}" alt=""></div>`
    : `<div class="mark"><span>${esc((sellerName.charAt(0) || "•").toUpperCase())}</span></div>`;

  // Seller address / contact block.
  const sellerLines: string[] = [];
  if (data.seller.address) sellerLines.push(esc(data.seller.address));
  if (data.seller.phone) sellerLines.push(`<span class="k">Phone</span>&nbsp; ${esc(data.seller.phone)}`);
  if (data.seller.email) sellerLines.push(`<span class="k">Email</span>&nbsp; ${esc(data.seller.email)}`);
  if (data.seller.gstin) sellerLines.push(`<span class="k">GSTIN</span>&nbsp; ${esc(data.seller.gstin)}`);
  if (data.seller.pan) sellerLines.push(`<span class="k">PAN</span>&nbsp; ${esc(data.seller.pan)}`);

  // Header meta rows (right column) — only those with a value.
  const metaRows: Array<[string, string, boolean]> = [];
  metaRows.push(["Quotation No.", esc(data.number), false]);
  metaRows.push(["Date", esc(fmtDate(data.date)), false]);
  if (data.validUntil) metaRows.push(["Valid Until", esc(fmtDate(data.validUntil)), false]);
  if ((data.subject ?? "").trim()) metaRows.push(["Subject", esc(data.subject), false]);
  const posName = gstStateName(v.placeOfSupplyState);
  if (posName) metaRows.push(["Place of Supply", `${esc(posName)} (${esc(v.placeOfSupplyState)})`, true]);
  const metaHtml = metaRows
    .map(([k, val, pos]) => `<dt>${k}</dt><dd${pos ? ' class="pos"' : ""}>${val}</dd>`)
    .join("");

  // Bill-to block.
  const billLines: string[] = [];
  const billAddr = [data.billTo.address, data.billTo.pin].filter(Boolean).map((s) => esc(s)).join(", ");
  if (billAddr) billLines.push(billAddr);
  const billMeta: string[] = [];
  if (data.billTo.phone) billMeta.push(`Phone ${esc(data.billTo.phone)}`);
  if (data.billTo.gstin) billMeta.push(`GSTIN ${esc(data.billTo.gstin)}`);
  if (billMeta.length) billLines.push(billMeta.join('<span class="sep">·</span>'));

  // Item rows.
  const rowsHtml = v.items.map((it) => {
    const chips: string[] = [];
    if (it.hsn) chips.push(`<span class="hsn">HSN ${esc(it.hsn)}</span>`);
    if (v.mixedRate) chips.push(`<span class="hsn">GST ${esc(it.taxPct)}%</span>`);
    const sub = `${chips.join(" ")}${chips.length && it.spec ? "<br>" : ""}${it.spec ? esc(it.spec) : ""}`;
    const thumbs = it.images.length
      ? `<div class="thumbs">${it.images.slice(0, 3).map((src) => `<img class="thumb" src="${esc(src)}" alt="">`).join("")}</div>`
      : `<span class="u">—</span>`;
    const taxPerUnit = Math.round(it.taxPaise / Math.max(1, it.quantity));
    return `<tr>
      <td class="l"><div class="piece">${esc(it.name)}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</td>
      <td>${qtyCell(it.quantity, it.unit)}</td>
      <td class="l">${thumbs}</td>
      <td>${money(it.unitPricePaise)}</td>
      <td>${money(taxPerUnit)}</td>
      <td class="num-strong">${money(it.amountPaise)}</td>
    </tr>`;
  }).join("");

  // Sub-total banner + the discount-reconciliation note (only when a discount applies).
  const barTax = v.cgstPaise + v.sgstPaise + v.igstPaise;
  const noteHtml = v.discountPaise > 0
    ? `<div class="note">Line amounts are shown before discount. The discount and GST (charged on the post-discount taxable value) are applied in the summary — the GST-compliant presentation.</div>`
    : "";

  // Tax summary (right column of the footer). Shows the taxable value, each GST component
  // with its rate, a combined "Total GST" line with the effective rate, and the final
  // amount payable INCLUDING GST — so the full billing + all taxes are explicit.
  const sumRows: string[] = [];
  if (v.discountPaise > 0) {
    sumRows.push(`<div class="row"><span class="lab">Sub Total</span><span class="val">${money(v.grossSubtotalPaise)}</span></div>`);
    sumRows.push(`<div class="row disc"><span class="lab">Discount</span><span class="val">− ${money(v.discountPaise)}</span></div>`);
    sumRows.push(`<div class="divider"></div>`);
  }
  sumRows.push(`<div class="row"><span class="lab">Taxable Amount</span><span class="val">${money(v.taxablePaise)}</span></div>`);
  for (const b of v.taxBands) {
    if (b.ratePct <= 0) continue;
    const on = v.mixedRate ? ` <span class="on">(on ${money(b.taxablePaise)})</span>` : "";
    if (v.interState) {
      sumRows.push(`<div class="row"><span class="lab">IGST @${esc(b.ratePct)}%${on}</span><span class="val">${money(b.igstPaise)}</span></div>`);
    } else {
      sumRows.push(`<div class="row"><span class="lab">CGST @${esc(b.ratePct / 2)}%${on}</span><span class="val">${money(b.cgstPaise)}</span></div>`);
      sumRows.push(`<div class="row"><span class="lab">SGST @${esc(b.ratePct / 2)}%${on}</span><span class="val">${money(b.sgstPaise)}</span></div>`);
    }
  }
  // Combined GST line — states the effective GST rate + total tax outright.
  const totalGstPaise = v.cgstPaise + v.sgstPaise + v.igstPaise;
  if (totalGstPaise > 0) {
    sumRows.push(`<div class="row gst"><span class="lab">Total GST${v.mixedRate ? "" : ` @${esc(v.gstPct)}%`}</span><span class="val">${money(totalGstPaise)}</span></div>`);
  }

  // Bank details (only if any field is present).
  const s = data.seller;
  const bank: string[] = [];
  if (s.bankAccountName) bank.push(`<b>Account holder</b> ${esc(s.bankAccountName)}`);
  const acc = [s.bankAccountNumber ? `<b>Account no.</b> ${esc(s.bankAccountNumber)}` : "", s.ifsc ? `<b>IFSC</b> ${esc(s.ifsc)}` : ""].filter(Boolean).join('<span class="sep">·</span>');
  if (acc) bank.push(acc);
  const bk = [s.bankName ? `<b>Bank</b> ${esc(s.bankName)}` : "", s.bankBranch ? esc(s.bankBranch) : ""].filter(Boolean).join(", ");
  if (bk) bank.push(bk);
  if (s.upi) bank.push(`<b>UPI</b> ${esc(s.upi)}`);
  const bankHtml = bank.length
    ? `<div class="block"><h3>Bank Details</h3><div class="kv">${bank.join("<br>")}</div></div>`
    : "";

  const notesHtml = (data.notes ?? "").trim()
    ? `<div class="block"><h3>Notes</h3><div class="kv">${esc(data.notes)}</div></div>`
    : "";

  const termsText = (data.terms && data.terms.trim()) ? data.terms : DEFAULT_TERMS;
  const termsHtml = termsText.split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
    .map((t) => `<li>${esc(t)}</li>`).join("");

  const signatory = s.signatory || sellerName;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
<title>Quotation ${esc(data.number)}</title>
<style>
  :root{
    --accent:${rgbCss(accent)}; --accent-d:${rgbCss(accentD)}; --on-accent:${onAcc};
    --paper:#fff; --panel:#faf7f5; --ink:#1b1d23; --muted:#6c7178; --faint:#9aa0a7;
    --hair:#dcdde2; --hair-2:#ebeced; --good:#2f7d4f;
    --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  }
  @page{ size:A4; margin:10mm; }
  *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html,body{ margin:0; padding:0; background:#fff; }
  body{ font-family:var(--sans); color:var(--ink); font-size:12px; line-height:1.4; -webkit-font-smoothing:antialiased; }

  .head{ display:grid; grid-template-columns:1.05fr 1px .95fr; gap:18px; }
  .head .rule{ background:var(--hair); }
  .brand{ display:flex; gap:11px; align-items:flex-start; }
  .brand .mark{ width:42px; height:42px; flex:none; border-radius:8px;
    background:linear-gradient(150deg,var(--accent),var(--accent-d)); display:flex; align-items:center; justify-content:center; }
  .brand .mark span{ font-family:var(--serif); color:var(--on-accent); font-size:23px; line-height:1; font-weight:700; }
  .brand .mark-img{ background:#fff; border:1px solid var(--hair); padding:4px; }
  .brand .mark-img img{ max-width:100%; max-height:100%; object-fit:contain; }
  .brand h1{ margin:0; font-family:var(--serif); font-weight:700; font-size:22px; letter-spacing:.01em; color:var(--accent); line-height:1.05; }
  .seller-lines{ margin-top:10px; display:grid; gap:2px; font-size:11.5px; color:var(--muted); }
  .seller-lines .k{ color:var(--ink); font-weight:600; }
  .doc-title{ font-family:var(--serif); font-size:27px; letter-spacing:.14em; color:var(--ink); margin:0 0 10px; font-weight:700; }
  .meta{ display:grid; grid-template-columns:auto 1fr; gap:5px 12px; font-size:11.5px; margin:0; }
  .meta dt{ color:var(--muted); }
  .meta dd{ margin:0; text-align:right; font-weight:600; font-variant-numeric:tabular-nums; }
  .meta dd.pos{ color:var(--accent); }

  .banner{ background:linear-gradient(180deg,var(--accent),var(--accent-d)); color:var(--on-accent);
    border-radius:5px; padding:6px 12px; font-size:11px; letter-spacing:.16em; text-transform:uppercase; font-weight:650; }
  .billto{ margin-top:13px; }
  .billto .who{ margin-top:7px; font-size:14px; font-weight:700; }
  .billto .lines{ margin-top:3px; font-size:11.5px; color:var(--muted); }
  .sep{ color:var(--hair); margin:0 8px; }

  .items{ margin-top:13px; }
  table{ width:100%; border-collapse:collapse; margin-top:8px; border:1px solid var(--hair); border-radius:6px; overflow:hidden; font-size:12px; }
  thead{ display:table-header-group; }
  thead th{ background:linear-gradient(180deg,var(--accent),var(--accent-d)); color:var(--on-accent);
    font-weight:600; letter-spacing:.04em; padding:6px 11px; text-align:right; white-space:nowrap; }
  thead th.l{ text-align:left; }
  tbody td{ padding:7px 11px; border-bottom:1px solid var(--hair-2); vertical-align:top; text-align:right; font-variant-numeric:tabular-nums; }
  tbody td.l{ text-align:left; }
  tbody tr:last-child td{ border-bottom:none; }
  tr{ break-inside:avoid; }
  .piece{ font-weight:700; font-size:12.5px; }
  .sub{ color:var(--muted); font-size:11px; margin-top:2px; }
  .u{ color:var(--muted); }
  .hsn{ display:inline-block; font-variant-numeric:tabular-nums; background:var(--panel); border:1px solid var(--hair);
    border-radius:4px; padding:0 5px; color:var(--ink); font-size:10.5px; }
  .thumbs{ display:flex; flex-wrap:wrap; gap:5px; }
  .thumb{ width:36px; height:28px; border-radius:4px; border:1px solid var(--hair); object-fit:cover; background:var(--panel); }
  .num-strong{ font-weight:700; }

  .subtotal-bar{ display:grid; grid-template-columns:1fr auto auto; gap:18px; align-items:center; margin-top:8px;
    padding:7px 13px; border-radius:6px; background:linear-gradient(180deg,var(--accent),var(--accent-d));
    color:var(--on-accent); font-size:12.5px; font-weight:650; font-variant-numeric:tabular-nums; break-inside:avoid; }
  .subtotal-bar .lbl{ letter-spacing:.12em; text-transform:uppercase; font-size:11px; }
  .note{ margin-top:5px; font-size:10px; color:var(--faint); font-style:italic; }

  /* The footer flows across a page break when needed (no whole-block break-avoid), so the
     summary / terms / signatures always render instead of being pushed off as one unit. */
  .foot{ margin-top:14px; display:grid; grid-template-columns:1fr .82fr; gap:26px; }
  .foot h3{ margin:0 0 5px; font-size:11px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink); }
  .block + .block{ margin-top:11px; }
  .kv{ font-size:11.5px; color:var(--muted); line-height:1.5; }
  .kv b{ color:var(--ink); font-weight:600; }
  .terms{ margin:0; padding:0; list-style:none; font-size:11px; color:var(--muted); line-height:1.4; }
  .terms li{ position:relative; padding-left:15px; margin-bottom:3px; }
  .terms li:before{ content:""; position:absolute; left:2px; top:6px; width:5px; height:5px; border-radius:50%; background:var(--accent); }

  .summary{ font-size:12px; }
  .summary .row{ display:flex; justify-content:space-between; gap:12px; padding:4px 0; font-variant-numeric:tabular-nums; }
  .summary .row .lab{ color:var(--muted); }
  .summary .row .on{ color:var(--faint); font-size:10.5px; }
  .summary .row .val{ font-weight:600; }
  .summary .row.disc .val{ color:var(--good); }
  .summary .row.gst .lab, .summary .row.gst .val{ color:var(--ink); font-weight:700; }
  .summary .divider{ height:1px; background:var(--hair); margin:4px 0; }
  .summary .grand{ display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-top:6px;
    padding:9px 12px; border-radius:6px; background:var(--panel); border:1px solid var(--hair); font-variant-numeric:tabular-nums; }
  .summary .grand .lab{ font-family:var(--serif); font-size:13.5px; font-weight:700; }
  .summary .grand .val{ font-family:var(--serif); font-size:18px; font-weight:700; color:var(--accent); }
  .summary .words{ margin-top:5px; font-size:10.5px; color:var(--muted); font-style:italic; text-align:right; }

  .signs{ margin-top:18px; display:grid; grid-template-columns:1fr 1fr; gap:26px; align-items:end; break-inside:avoid; }
  .sign .line{ border-top:1px solid var(--hair); padding-top:6px; font-size:11px; color:var(--muted); }
  .sign.right{ text-align:right; }
  .sign.right .for{ font-size:11px; color:var(--muted); }
  .sign.right .co{ font-family:var(--serif); font-weight:700; font-size:13px; color:var(--ink); margin-top:2px; letter-spacing:.04em; }
  .footer-mark{ margin-top:12px; padding-top:8px; border-top:1px solid var(--hair-2); display:flex; justify-content:space-between;
    font-size:10px; color:var(--faint); letter-spacing:.04em; }
</style>
</head>
<body><div class="sheet">
  <header class="head">
    <div class="left">
      <div class="brand">${markHtml}<div><h1>${esc(sellerName)}</h1></div></div>
      <div class="seller-lines">${sellerLines.map((l) => `<div>${l}</div>`).join("")}</div>
    </div>
    <div class="rule"></div>
    <div class="right">
      <div class="doc-title">QUOTATION</div>
      <dl class="meta">${metaHtml}</dl>
    </div>
  </header>

  <section class="billto">
    <div class="banner">Bill To</div>
    ${data.billTo.name ? `<div class="who">${esc(data.billTo.name)}</div>` : ""}
    ${billLines.length ? `<div class="lines">${billLines.join("<br>")}</div>` : ""}
  </section>

  <section class="items">
    <div class="banner">Items</div>
    <table>
      <thead><tr>
        <th class="l">Item &amp; specification</th><th>Qty</th><th class="l">Image(s)</th>
        <th>Price / Unit</th><th>Tax / Unit</th><th>Amount</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="subtotal-bar">
      <span class="lbl">Sub Total &nbsp;·&nbsp; ${esc(v.totalQuantity)} units</span>
      <span>Tax ${money(barTax)}</span>
      <span>${money(v.subTotalPaise)}</span>
    </div>
    ${noteHtml}
  </section>

  <section class="foot">
    <div class="left">
      ${bankHtml}
      ${notesHtml}
      <div class="block"><h3>Terms &amp; Conditions</h3><ul class="terms">${termsHtml}</ul></div>
    </div>
    <div class="right">
      <div class="summary">
        ${sumRows.join("")}
        <div class="grand"><span class="lab">Total (incl. GST)</span><span class="val">${money(v.grandTotalPaise)}</span></div>
        <div class="words">${esc(amountInWords(v.grandTotalPaise))}</div>
      </div>
    </div>
  </section>

  <section class="signs">
    <div class="sign left"><div class="line">Customer Signature</div></div>
    <div class="sign right"><div class="line"><div class="for">Authorised Signatory for</div><div class="co">${esc(signatory)}</div></div></div>
  </section>

  <div class="footer-mark"><span>Thank you for your business.</span><span></span></div>
</div></body></html>`;
}

// Render the quotation HTML to a real PDF via headless Chromium. Returns null when the
// browser is unavailable or rendering fails, so the caller falls back to the pdf-lib
// renderer — the download endpoint never breaks.
export async function renderQuotationPdfHtml(data: QuotationPdfData): Promise<Uint8Array | null> {
  const launched = await launchPdfBrowser();
  if (!launched) return null;
  const { browser, page } = launched;
  try {
    await page.emulateMedia?.({ media: "print" });
    await page.setContent(renderQuotationHtml(data), { waitUntil: "load", timeout: 20_000 });
    // Natural pagination: content fills the page top-to-bottom and flows to the next page
    // only when the page is actually full — no forced single-page scaling, and no
    // whole-section "break-inside: avoid" that would leave a page half-empty.
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    return pdf?.length ? new Uint8Array(pdf) : null;
  } catch {
    return null;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
