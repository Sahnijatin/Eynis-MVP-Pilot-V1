// Branded quotation PDF — a proper customer-facing quotation (not the generic report
// layout): seller letterhead with tax details, a Bill-To block, an itemised table with
// per-unit GST, a CGST/SGST tax summary, bank details, terms, and signatures. Built on
// pdf-lib (pure-TS, standard fonts) so it emits a real application/pdf.
//
// The layout mirrors a standard Indian GST quotation. The accent colour comes from the
// tenant brand (white-label), so it themes per tenant. All money is integer paise.

import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { SellerDetails, BillTo, QuotationView } from "../quotes/quotation";
import { gstStateName, amountInWords } from "../quotes/quotation";
import { tryEmbedLogo } from "./report-pdf";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 34;
const LEFT = MARGIN;
const RIGHT = A4[0] - MARGIN;
const CONTENT_W = A4[0] - MARGIN * 2;

const WHITE = rgb(1, 1, 1);
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.46, 0.52);
const LINE = rgb(0.82, 0.84, 0.87);
const LINKBLUE = rgb(0.11, 0.35, 0.75);

// Attach a clickable URI link annotation over a rectangle on a page. pdf-lib has no
// high-level link API, so we build the annotation dict directly and append it to the
// page's /Annots. Supported by every mainstream PDF viewer.
function addLink(page: PDFPage, rect: [number, number, number, number], uri: string) {
  const doc = page.doc;
  const ref = doc.context.register(
    doc.context.obj({
      Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(uri) },
    }),
  );
  const existing = page.node.Annots();
  if (existing) existing.push(ref);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
}

const hexToRgb = (hex: string): RGB => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || "").trim());
  if (!m) return rgb(0.55, 0.05, 0.08); // fallback deep red (matches a classic quotation)
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
};

// Helvetica is WinAnsi (Latin-1). Map ₹ and the common "smart" punctuation that
// copy-paste from Word/email/browsers inserts (em/en dashes, curly quotes, ellipsis,
// bullets) to Latin-1 equivalents so they RENDER instead of being silently deleted.
// Anything still outside Latin-1 (e.g. Devanagari/Tamil names) is dropped — rendering
// those needs an embedded Unicode font, tracked separately. drawText never throws.
const safe = (s: unknown): string =>
  String(s ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[‒-―]/g, "-") // figure/en/em/horizontal dashes → hyphen
    .replace(/[‘’‚‛]/g, "'") // curly single quotes/low-9 → '
    .replace(/[“”„‟]/g, '"') // curly double quotes/low-9 → "
    .replace(/…/g, "...") // horizontal ellipsis
    .replace(/•/g, "-") // bullet → hyphen
    .replace(/[^\x00-\xFF]/g, "");
// Indian digit grouping (lakh/crore): 12500000 paise → "Rs. 1,25,000.00".
const money = (paise: number): string =>
  `Rs. ${(Math.round(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  subject?: string | null; // the quote title, shown as its own "Subject" line (not jammed into the number)
  date: Date;
  seller: SellerDetails;
  billTo: BillTo;
  view: QuotationView;
  notes?: string | null;
  terms?: string | null;
  validUntil?: Date | null;
  accentColor: string;
  brandName: string;
  // Tenant brand logo (best-effort). Fetched + embedded server-side via the shared
  // SSRF-guarded helper; null/unreachable → text seller name only (no logo).
  logoUrl?: string | null;
  // Absolute URL prefix for image links, e.g. "https://demo.eynis.com/api/public/
  // quote-image/<token>". The Image(s) column renders "Image N" links to `${base}/<idx>`
  // (opens) and `${base}/<idx>?download=1` (downloads). Null → plain text, no links.
  imageLinkBase?: string | null;
}

// Item table column layout (fractions of content width). Numeric columns are right-aligned.
// The Image(s) column (clickable "Image N" links) sits right after Quantity.
const COLS = { item: 0.34, qty: 0.07, images: 0.14, price: 0.15, tax: 0.14, amount: 0.16 };

// Neutral, industry-agnostic boilerplate shown when the quote carries no terms of its
// own, so the document is never blank there. Kept generic (no payment/advance terms) so
// it's safe for any tenant; a tenant that sets its own terms overrides this entirely.
const DEFAULT_TERMS = [
  "This is a quotation and not a tax invoice.",
  "Prices are valid until the validity date shown above; if no validity is stated, this quotation is valid for 15 days from the date of issue.",
  "Applicable taxes are as shown above and subject to the prevailing rates at the time of billing.",
  "This quotation does not constitute a confirmed order until accepted in writing.",
].join("\n");

export async function renderQuotationPdf(data: QuotationPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb(data.accentColor);
  const linkBase = (data.imageLinkBase ?? "").trim().replace(/\/$/, "") || null;
  const logo = await tryEmbedLogo(doc, data.logoUrl ?? null);

  let page: PDFPage = doc.addPage(A4);
  const top = A4[1] - MARGIN;
  let y = top;

  const T = (s: string, x: number, yy: number, size: number, f: PDFFont, color: RGB) =>
    page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const TR = (s: string, xRight: number, yy: number, size: number, f: PDFFont, color: RGB) => {
    const w = f.widthOfTextAtSize(safe(s), size);
    page.drawText(safe(s), { x: xRight - w, y: yy, size, font: f, color });
  };

  // Column x-edges for the items table (Image(s) column inserted after Quantity).
  const cItem = LEFT;
  const cQty = LEFT + CONTENT_W * COLS.item;
  const cImg = cQty + CONTENT_W * COLS.qty;
  const cPrice = cImg + CONTENT_W * COLS.images;
  const cTax = cPrice + CONTENT_W * COLS.price;
  const cAmount = cTax + CONTENT_W * COLS.tax; // amount col right edge = RIGHT

  // ── Header: seller (left) | QUOTATION + meta (right) ──────────────────────────
  const midX = LEFT + CONTENT_W * 0.52;
  const sellerName = data.seller.name || data.brandName || "Your Company";
  const leftMaxW = midX - LEFT - 8;
  let ly = y - 6;
  // Letterhead: brand logo (if any) above the seller name, else the name at full size.
  if (logo) {
    const logoH = 40;
    const logoW = Math.min((logo.width / logo.height) * logoH, leftMaxW, 200);
    const drawH = logoW / (logo.width / logo.height);
    page.drawImage(logo, { x: LEFT, y: ly - drawH, width: logoW, height: drawH });
    ly -= drawH + 8;
    T(truncate(sellerName, bold, 13, leftMaxW), LEFT, ly - 11, 13, bold, accent);
    ly -= 22;
  } else {
    T(truncate(sellerName, bold, 20, leftMaxW), LEFT, ly - 14, 20, bold, accent);
    ly -= 30;
  }
  const sellerLines: string[] = [];
  if (data.seller.address) sellerLines.push(...wrap(data.seller.address, font, 9, midX - LEFT - 8));
  if (data.seller.phone) sellerLines.push(`Phone: ${data.seller.phone}`);
  if (data.seller.email) sellerLines.push(`Email: ${data.seller.email}`);
  if (data.seller.gstin) sellerLines.push(`GSTIN: ${data.seller.gstin}`);
  if (data.seller.pan) sellerLines.push(`PAN Number: ${data.seller.pan}`);
  for (const line of sellerLines) { T(truncate(line, font, 9, midX - LEFT - 8), LEFT, ly, 9, font, INK); ly -= 13; }

  // Right column. This is a QUOTATION, not a tax invoice — so the meta labels read
  // "Quotation No/Date", and the quote subject gets its OWN labelled line rather than
  // being concatenated into the number.
  let ry = y - 6;
  const rightMaxW = RIGHT - (midX + 8);
  const metaRow = (label: string, value: string) => {
    T(label, midX + 8, ry, 9, bold, INK);
    const lw = bold.widthOfTextAtSize(`${label} `, 9);
    T(truncate(value, font, 9, rightMaxW - lw), midX + 8 + lw, ry, 9, font, INK);
    ry -= 14;
  };
  T("QUOTATION", midX + 8, ry - 14, 20, bold, INK);
  ry -= 34;
  metaRow("Quotation No:", safe(data.number));
  const dateStr = data.date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  metaRow("Quotation Date:", dateStr);
  if (data.validUntil) {
    metaRow("Valid Until:", data.validUntil.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }));
  }
  const subject = (data.subject ?? "").trim();
  if (subject) metaRow("Subject:", subject);
  // Place of supply — the buyer's GST state, printed on GST documents.
  const posCode = data.view.placeOfSupplyState;
  const posName = gstStateName(posCode);
  if (posName) metaRow("Place of Supply:", `${posName} (${posCode})`);

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
    T("Qty", cQty + 6, hy, 9, bold, WHITE);
    T("Image(s)", cImg + 4, hy, 9, bold, WHITE);
    T("Price/Unit", cPrice + 4, hy, 9, bold, WHITE);
    T("Tax/Unit", cTax + 4, hy, 9, bold, WHITE);
    TR("Amount", RIGHT - 8, hy, 9, bold, WHITE);
    y -= headerH;
  };
  drawTableHeader();

  // Draw the "Image N" / "download" links for a row, stacked in the Image(s) cell.
  // Each image gets an "Image N" link (opens) and a smaller "download" link beside it.
  // With no linkBase (public URL not configured), it degrades to plain "Image N" text.
  const drawRowImageLinks = (indices: number[], rowTopY: number) => {
    let ly = rowTopY - 13;
    indices.forEach((gidx, j) => {
      const label = `Image ${j + 1}`;
      const x = cImg + 4;
      T(label, x, ly, 8.5, font, linkBase ? LINKBLUE : MUTED);
      if (linkBase) {
        const w = font.widthOfTextAtSize(label, 8.5);
        addLink(page, [x, ly - 2, x + w, ly + 9], `${linkBase}/${gidx}`);
        const dlX = x + w + 6;
        T("download", dlX, ly, 7, font, MUTED);
        addLink(page, [dlX, ly - 2, dlX + font.widthOfTextAtSize("download", 7), ly + 8], `${linkBase}/${gidx}?download=1`);
      }
      ly -= 12;
    });
  };

  const bottomLimit = MARGIN + 150; // reserve room for the summary + signatures
  const specColW = (cQty - cItem) - 12; // Items column inner width (name + wrapped spec)
  for (const it of data.view.items) {
    const imgCount = it.imageIndices?.length ?? 0;
    // Muted sub-lines under the item name: HSN/SAC code (if any) then the spec, which
    // wraps to at most 2 lines instead of hard-truncating so multi-component pieces read
    // fully. Row height clears whichever is taller: this stack or the image links.
    const subLines = [
      ...(it.hsn ? [`HSN/SAC: ${it.hsn}`] : []),
      ...(it.spec ? wrap(it.spec, font, 8, specColW).slice(0, 2) : []),
    ];
    const textH = subLines.length === 0 ? 22 : 30 + (subLines.length - 1) * 10;
    const imgH = imgCount ? Math.max(30, 14 + imgCount * 12) : 0;
    const rowH = Math.max(22, textH, imgH);
    if (y - rowH < bottomLimit) { page = doc.addPage(A4); y = A4[1] - MARGIN; drawTableHeader(); }
    const ty = y - 15;
    T(truncate(it.name, bold, 10, specColW), cItem + 8, ty, 10, bold, INK);
    subLines.forEach((ln, k) => T(ln, cItem + 8, ty - 11 - k * 10, 8, font, MUTED));
    T(`${it.quantity} ${it.unit}`, cQty + 6, ty, 9, font, INK);
    if (imgCount) drawRowImageLinks(it.imageIndices, y);
    T(money(it.unitPricePaise), cPrice + 4, ty, 9, font, INK);
    // Per-line tax amount only — the rate is stated in the summary (CGST/SGST/IGST @…%).
    T(money(it.taxPaise), cTax + 4, ty, 8.5, font, INK);
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
  T(money(data.view.cgstPaise + data.view.sgstPaise + data.view.igstPaise), cTax + 4, sy, 9, bold, WHITE);
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
  // Discount-before-tax presentation (GST-compliant): list Sub Total, less the Discount,
  // gives the Taxable Amount, then GST is charged on that post-discount value.
  if (data.view.discountPaise > 0) {
    sumRow("Sub Total", money(data.view.grossSubtotalPaise));
    sumRow("Discount", `- ${money(data.view.discountPaise)}`);
  }
  sumRow("Taxable Amount", money(data.view.taxablePaise));
  if (data.view.gstPct > 0) {
    if (data.view.interState) {
      // Inter-state supply → single IGST line at the full rate.
      sumRow(`IGST @${data.view.gstPct}%`, money(data.view.igstPaise));
    } else {
      sumRow(`CGST @${halfPct}%`, money(data.view.cgstPaise));
      sumRow(`SGST @${halfPct}%`, money(data.view.sgstPaise));
    }
  }
  page.drawLine({ start: { x: rightX, y: lyR + 6 }, end: { x: RIGHT, y: lyR + 6 }, thickness: 0.75, color: LINE });
  lyR -= 6;
  sumRow("Total Amount", money(data.view.grandTotalPaise), true);
  // Total in words (conventional on Indian quotations/invoices).
  lyR -= 2;
  for (const wl of wrap(amountInWords(data.view.grandTotalPaise), font, 8, rightColW)) { T(wl, rightX, lyR, 8, font, MUTED); lyR -= 11; }

  // Left: bank details, notes, terms.
  const s = data.seller;
  const bankLines: string[] = [];
  if (s.bankAccountName) bankLines.push(`Account holder: ${s.bankAccountName}`);
  if (s.bankAccountNumber) bankLines.push(`Account number: ${s.bankAccountNumber}`);
  if (s.bankName) bankLines.push(`Bank: ${s.bankName}`);
  if (s.bankBranch) bankLines.push(`Branch: ${s.bankBranch}`);
  if (s.ifsc) bankLines.push(`IFSC code: ${s.ifsc}`);
  if (s.upi) bankLines.push(`UPI ID: ${s.upi}`);
  // Long bank/notes/terms must not overflow the page — spill to a fresh page (reserving
  // room below for the signature block) instead of drawing over the bottom margin/border.
  const leftBottom = MARGIN + 60;
  let leftPaginated = false;
  const ensureLeft = (need: number) => {
    if (lyL - need < leftBottom) { page = doc.addPage(A4); lyL = A4[1] - MARGIN; leftPaginated = true; }
  };
  const heading = (label: string) => { ensureLeft(15); T(label, LEFT, lyL, 10, bold, INK); lyL -= 15; };
  const bodyLines = (lines: string[], size = 9) => { for (const l of lines) { ensureLeft(size + 4); T(truncate(l, font, size, leftColW), LEFT, lyL, size, font, INK); lyL -= size + 4; } };
  if (bankLines.length) { heading("Bank Details"); bodyLines(bankLines); lyL -= 8; }
  if (data.notes) { heading("Notes"); bodyLines(wrap(data.notes, font, 9, leftColW)); lyL -= 8; }
  const termsText = (data.terms && data.terms.trim()) ? data.terms : DEFAULT_TERMS;
  { heading("Terms & Conditions"); bodyLines(wrap(termsText, font, 9, leftColW)); lyL -= 8; }

  // ── Signatures ────────────────────────────────────────────────────────────────
  // Anchor the signature block to the bottom of the page (standard document layout).
  // If the content already reaches too far down to fit it, move to a fresh page so the
  // signatures never overlap the tax summary / terms. When the left column spilled to a
  // new page, the tax summary is on an earlier page, so only the left cursor matters.
  const contentBottomY = leftPaginated ? lyL : Math.min(lyL, lyR);
  const footY = MARGIN + 36;
  if (contentBottomY < footY + 24) { page = doc.addPage(A4); y = A4[1] - MARGIN; }
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
