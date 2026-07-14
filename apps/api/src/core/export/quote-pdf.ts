// Branded quotation PDF — a proper customer-facing quotation (not the generic report
// layout): seller letterhead with tax details, a Bill-To block, an itemised table with
// per-unit GST, a CGST/SGST tax summary, bank details, terms, and signatures. Built on
// pdf-lib (pure-TS, standard fonts) so it emits a real application/pdf.
//
// The layout mirrors a standard Indian GST quotation. The accent colour comes from the
// tenant brand (white-label), so it themes per tenant. All money is integer paise.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { SellerDetails, BillTo, QuotationView } from "../quotes/quotation";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 34;
const LEFT = MARGIN;
const RIGHT = A4[0] - MARGIN;
const CONTENT_W = A4[0] - MARGIN * 2;

const WHITE = rgb(1, 1, 1);
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.46, 0.52);
const LINE = rgb(0.82, 0.84, 0.87);

const hexToRgb = (hex: string): RGB => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || "").trim());
  if (!m) return rgb(0.55, 0.05, 0.08); // fallback deep red (matches a classic quotation)
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
};

// Helvetica is WinAnsi — map ₹ and drop anything unencodable so drawText never throws.
const safe = (s: unknown): string => String(s ?? "").replace(/₹/g, "Rs.").replace(/[^\x00-\xFF]/g, "");
const money = (paise: number): string => `Rs. ${(Math.round(paise) / 100).toFixed(2)}`;

function truncate(s: string, font: PDFFont, size: number, maxW: number): string {
  s = safe(s);
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (cur && font.widthOfTextAtSize(test, size) > maxW) { out.push(cur); cur = w; } else cur = test;
    }
    if (cur || !words.length) out.push(cur);
  }
  return out.length ? out : [""];
}

export interface QuotationPdfData {
  number: string;
  date: Date;
  seller: SellerDetails;
  billTo: BillTo;
  view: QuotationView;
  notes?: string | null;
  terms?: string | null;
  validUntil?: Date | null;
  accentColor: string;
  brandName: string;
}

// Item table column layout (fractions of content width). Numeric columns are right-aligned.
const COLS = { item: 0.42, qty: 0.13, price: 0.17, tax: 0.16, amount: 0.12 };

export async function renderQuotationPdf(data: QuotationPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb(data.accentColor);

  let page: PDFPage = doc.addPage(A4);
  const top = A4[1] - MARGIN;
  let y = top;

  const T = (s: string, x: number, yy: number, size: number, f: PDFFont, color: RGB) =>
    page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const TR = (s: string, xRight: number, yy: number, size: number, f: PDFFont, color: RGB) => {
    const w = f.widthOfTextAtSize(safe(s), size);
    page.drawText(safe(s), { x: xRight - w, y: yy, size, font: f, color });
  };

  // Column x-edges for the items table.
  const cItem = LEFT;
  const cQty = LEFT + CONTENT_W * COLS.item;
  const cPrice = cQty + CONTENT_W * COLS.qty;
  const cTax = cPrice + CONTENT_W * COLS.price;
  const cAmount = cTax + CONTENT_W * COLS.tax; // amount col right edge = RIGHT

  // ── Header: seller (left) | QUOTATION + meta (right) ──────────────────────────
  const midX = LEFT + CONTENT_W * 0.52;
  const sellerName = data.seller.name || data.brandName || "Your Company";
  let ly = y - 6;
  T(truncate(sellerName, bold, 20, midX - LEFT - 8), LEFT, ly - 14, 20, bold, accent);
  ly -= 30;
  const sellerLines: string[] = [];
  if (data.seller.address) sellerLines.push(...wrap(data.seller.address, font, 9, midX - LEFT - 8));
  if (data.seller.phone) sellerLines.push(`Phone: ${data.seller.phone}`);
  if (data.seller.gstin) sellerLines.push(`GSTIN: ${data.seller.gstin}`);
  if (data.seller.pan) sellerLines.push(`PAN Number: ${data.seller.pan}`);
  for (const line of sellerLines) { T(truncate(line, font, 9, midX - LEFT - 8), LEFT, ly, 9, font, INK); ly -= 13; }

  // Right column.
  let ry = y - 6;
  T("QUOTATION", midX + 8, ry - 14, 20, bold, INK);
  ry -= 34;
  T("Invoice No:", midX + 8, ry, 9, bold, INK);
  T(safe(data.number), midX + 8 + bold.widthOfTextAtSize("Invoice No: ", 9), ry, 9, font, INK);
  ry -= 14;
  const dateStr = data.date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  T("Invoice Date:", midX + 8, ry, 9, bold, INK);
  T(dateStr, midX + 8 + bold.widthOfTextAtSize("Invoice Date: ", 9), ry, 9, font, INK);
  ry -= 14;
  if (data.validUntil) {
    T("Valid Until:", midX + 8, ry, 9, bold, INK);
    T(data.validUntil.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), midX + 8 + bold.widthOfTextAtSize("Valid Until: ", 9), ry, 9, font, INK);
    ry -= 14;
  }

  y = Math.min(ly, ry) - 6;
  page.drawLine({ start: { x: midX, y: top + 2 }, end: { x: midX, y: y + 6 }, thickness: 0.75, color: LINE });

  // ── BILL TO banner ────────────────────────────────────────────────────────────
  const bannerH = 20;
  page.drawRectangle({ x: LEFT, y: y - bannerH, width: CONTENT_W, height: bannerH, color: accent });
  T("BILL TO", LEFT + 10, y - 14, 10, bold, WHITE);
  y -= bannerH + 14;
  if (data.billTo.name) { T(truncate(data.billTo.name, bold, 12, CONTENT_W), LEFT, y, 12, bold, INK); y -= 15; }
  const billLines: string[] = [];
  if (data.billTo.address) billLines.push(...wrap(data.billTo.address, font, 9, CONTENT_W));
  if (data.billTo.pin) billLines.push(`Pin: ${data.billTo.pin}`);
  if (data.billTo.phone) billLines.push(`Phone: ${data.billTo.phone}`);
  if (data.billTo.gstin) billLines.push(`GSTIN: ${data.billTo.gstin}`);
  for (const line of billLines) { T(truncate(line, font, 9, CONTENT_W), LEFT, y, 9, font, INK); y -= 12; }
  y -= 12;

  // ── Items table ───────────────────────────────────────────────────────────────
  const headerH = 22;
  const drawTableHeader = () => {
    page.drawRectangle({ x: LEFT, y: y - headerH, width: CONTENT_W, height: headerH, color: accent });
    const hy = y - 15;
    T("Items", cItem + 8, hy, 9, bold, WHITE);
    T("Quantity", cQty + 6, hy, 9, bold, WHITE);
    T("Price per Unit", cPrice + 4, hy, 9, bold, WHITE);
    T("Tax per Unit", cTax + 4, hy, 9, bold, WHITE);
    TR("Amount", RIGHT - 8, hy, 9, bold, WHITE);
    y -= headerH;
  };
  drawTableHeader();

  const bottomLimit = MARGIN + 150; // reserve room for the summary + signatures
  for (const it of data.view.items) {
    const rowH = it.spec ? 30 : 22;
    if (y - rowH < bottomLimit) { page = doc.addPage(A4); y = A4[1] - MARGIN; drawTableHeader(); }
    const ty = y - 15;
    T(truncate(it.name, bold, 10, (cQty - cItem) - 12), cItem + 8, ty, 10, bold, INK);
    if (it.spec) T(truncate(it.spec, font, 8, (cQty - cItem) - 12), cItem + 8, ty - 11, 8, font, MUTED);
    T(`${it.quantity} ${it.unit}`, cQty + 6, ty, 9, font, INK);
    T(money(it.unitPricePaise), cPrice + 4, ty, 9, font, INK);
    T(`${money(it.taxPaise)} (${it.taxPct}%)`, cTax + 4, ty, 8.5, font, INK);
    TR(money(it.amountPaise), RIGHT - 8, ty, 9, font, INK);
    page.drawLine({ start: { x: LEFT, y: y - rowH }, end: { x: RIGHT, y: y - rowH }, thickness: 0.5, color: LINE });
    y -= rowH;
  }

  // Sub Total banner.
  const subH = 22;
  page.drawRectangle({ x: LEFT, y: y - subH, width: CONTENT_W, height: subH, color: accent });
  const sy = y - 15;
  T("Sub Total", cItem + 8, sy, 9, bold, WHITE);
  T(String(data.view.totalQuantity), cQty + 6, sy, 9, bold, WHITE);
  T(money(data.view.cgstPaise + data.view.sgstPaise), cTax + 4, sy, 9, bold, WHITE);
  TR(money(data.view.subTotalPaise), RIGHT - 8, sy, 9, bold, WHITE);
  y -= subH + 16;

  // ── Lower section: bank/notes/terms (left) | tax summary (right) ──────────────
  const colGap = 24;
  const rightColW = CONTENT_W * 0.42;
  const rightX = RIGHT - rightColW;
  const leftColW = rightX - colGap - LEFT;
  let lyL = y;
  let lyR = y;

  // Right: tax summary.
  const sumRow = (label: string, value: string, boldRow = false) => {
    const f = boldRow ? bold : font;
    T(label, rightX, lyR, boldRow ? 11 : 9.5, f, boldRow ? INK : MUTED);
    TR(value, RIGHT, lyR, boldRow ? 11 : 9.5, f, INK);
    lyR -= boldRow ? 20 : 16;
  };
  const halfPct = data.view.gstPct / 2;
  sumRow("Taxable Amount", money(data.view.taxablePaise));
  if (data.view.gstPct > 0) {
    sumRow(`CGST @${halfPct}%`, money(data.view.cgstPaise));
    sumRow(`SGST @${halfPct}%`, money(data.view.sgstPaise));
  }
  if (data.view.discountPaise > 0) sumRow("Discount", `- ${money(data.view.discountPaise)}`);
  page.drawLine({ start: { x: rightX, y: lyR + 6 }, end: { x: RIGHT, y: lyR + 6 }, thickness: 0.75, color: LINE });
  lyR -= 6;
  sumRow("Total Amount", money(data.view.grandTotalPaise), true);

  // Left: bank details, notes, terms.
  const s = data.seller;
  const bankLines: string[] = [];
  if (s.bankAccountName) bankLines.push(`Account holder: ${s.bankAccountName}`);
  if (s.bankAccountNumber) bankLines.push(`Account number: ${s.bankAccountNumber}`);
  if (s.bankName) bankLines.push(`Bank: ${s.bankName}`);
  if (s.bankBranch) bankLines.push(`Branch: ${s.bankBranch}`);
  if (s.ifsc) bankLines.push(`IFSC code: ${s.ifsc}`);
  if (s.upi) bankLines.push(`UPI ID: ${s.upi}`);
  const heading = (label: string) => { T(label, LEFT, lyL, 10, bold, INK); lyL -= 15; };
  const bodyLines = (lines: string[], size = 9) => { for (const l of lines) { T(truncate(l, font, size, leftColW), LEFT, lyL, size, font, INK); lyL -= size + 4; } };
  if (bankLines.length) { heading("Bank Details"); bodyLines(bankLines); lyL -= 8; }
  if (data.notes) { heading("Notes"); bodyLines(wrap(data.notes, font, 9, leftColW)); lyL -= 8; }
  if (data.terms) { heading("Terms & Conditions"); bodyLines(wrap(data.terms, font, 9, leftColW)); lyL -= 8; }

  // ── Signatures ────────────────────────────────────────────────────────────────
  const footY = Math.max(MARGIN + 24, Math.min(lyL, lyR) - 24);
  page.drawLine({ start: { x: LEFT, y: footY + 14 }, end: { x: LEFT + 150, y: footY + 14 }, thickness: 0.5, color: LINE });
  T("Customer Signature", LEFT, footY, 9, font, MUTED);
  page.drawLine({ start: { x: RIGHT - 170, y: footY + 14 }, end: { x: RIGHT, y: footY + 14 }, thickness: 0.5, color: LINE });
  TR("Authorised Signatory For", RIGHT, footY, 9, font, MUTED);
  TR(truncate(sellerName, bold, 10, 170), RIGHT, footY - 13, 10, bold, INK);

  // Outer border on every page for the boxed look.
  for (const p of doc.getPages()) {
    p.drawRectangle({ x: MARGIN - 8, y: MARGIN - 8, width: A4[0] - (MARGIN - 8) * 2, height: A4[1] - (MARGIN - 8) * 2, borderColor: LINE, borderWidth: 1 });
  }

  return doc.save();
}
