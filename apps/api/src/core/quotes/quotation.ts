// Quotation letterhead + customer-facing view — the data behind the branded
// quotation PDF. Pure (no Prisma/I/O) so it is unit-testable.
//
// Two concerns live here:
//  1. SellerDetails / BillTo — the per-quote letterhead SNAPSHOT (issuer business/
//     tax/bank details + the customer bill-to block). Stored as JSON on the Quote.
//  2. buildQuotationView — turns the internal cost-component quote into the
//     customer-facing document: one line PER PIECE (groupName) at an allocated
//     selling price, with GST split into CGST/SGST. Internal material/labor/overhead/
//     margin never appears. All money is integer paise.

import { gstAmountPaise } from "./costing"; // the ONE GST formula — see below (pure, no I/O)

export interface SellerDetails {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankBranch?: string;
  ifsc?: string;
  upi?: string;
  signatory?: string;
  logo?: string; // seller company logo for the letterhead — an uploaded data:image/png|jpeg
  // URL (bounded) or a plain hosted URL. Kept out of SELLER_KEYS so it bypasses the tight
  // 400-char text cap; sanitised separately in cleanSeller.
}

export interface BillTo {
  name?: string;
  address?: string;
  pin?: string;
  phone?: string;
  gstin?: string;
  stateCode?: string; // explicit Place of Supply (2-digit GST state code) — for B2C /
  // unregistered buyers whose GSTIN doesn't carry the ship-to state
}

const SELLER_KEYS: (keyof SellerDetails)[] = [
  "name", "address", "phone", "email", "gstin", "pan",
  "bankAccountName", "bankAccountNumber", "bankName", "bankBranch", "ifsc", "upi", "signatory",
];
const BILLTO_KEYS: (keyof BillTo)[] = ["name", "address", "pin", "phone", "gstin", "stateCode"];

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s ? s.slice(0, 400) : undefined; // cap to keep the snapshot bounded
};

// The seller logo is either an uploaded raster inlined as a data: URL (png/jpeg only —
// the formats the PDF embedder renders) or a plain hosted URL. Data URLs are decoded-size
// bounded so a crafted quote can't bloat the sellerJson snapshot; anything malformed/
// oversized is dropped (→ no logo), matching how the workspace branding logo is handled.
const SELLER_LOGO_MAX_BYTES = 700 * 1024;
const sellerLogo = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return undefined;
  if (/^data:/i.test(s)) {
    const m = /^data:image\/(png|jpe?g);base64,([a-z0-9+/=]+)$/i.exec(s);
    if (!m) return undefined;
    const bytes = Math.floor((m[2].length * 3) / 4);
    return bytes > 0 && bytes <= SELLER_LOGO_MAX_BYTES ? s : undefined;
  }
  return s.length <= 4096 ? s : undefined; // plain URL — bound the length
};

// Sanitize an untrusted input object down to the known keys (drops anything else).
export function cleanSeller(o: unknown): SellerDetails {
  const src = (o ?? {}) as Record<string, unknown>;
  const out: SellerDetails = {};
  for (const k of SELLER_KEYS) { const v = str(src[k]); if (v) out[k] = v; }
  const logo = sellerLogo(src.logo);
  if (logo) out.logo = logo;
  return out;
}
export function cleanBillTo(o: unknown): BillTo {
  const src = (o ?? {}) as Record<string, unknown>;
  const out: BillTo = {};
  for (const k of BILLTO_KEYS) { const v = str(src[k]); if (v) out[k] = v; }
  return out;
}

export function parseSeller(json: string | null | undefined): SellerDetails {
  if (!json) return {};
  try { return cleanSeller(JSON.parse(json)); } catch { return {}; }
}
export function parseBillTo(json: string | null | undefined): BillTo {
  if (!json) return {};
  try { return cleanBillTo(JSON.parse(json)); } catch { return {}; }
}

// Serialize for storage — returns null when nothing meaningful was provided, so an
// empty letterhead stays NULL in the DB rather than "{}".
export function serializeSeller(o: unknown): string | null {
  const c = cleanSeller(o);
  return Object.keys(c).length ? JSON.stringify(c) : null;
}
export function serializeBillTo(o: unknown): string | null {
  const c = cleanBillTo(o);
  return Object.keys(c).length ? JSON.stringify(c) : null;
}

// Per-piece images shown on the quotation PDF, keyed by groupName. Each value is a
// small resized image data URL (data:image/png|jpeg;base64,…), max 3 per piece.
export type LineImages = Record<string, string[]>;

const MAX_IMAGES_PER_ROW = 3;
const MAX_IMAGE_BYTES = 1_500 * 1024; // per image, after client-side resize to ~1600px
const MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024; // whole quote (the quote-save route raises its body cap to match)

// Accept only png/jpeg data URLs; reject anything else (svg, remote URLs, junk). The
// base64 payload must decode and be within the per-image byte cap.
function validImageDataUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(v.trim());
  if (!m) return null;
  const bytes = Math.floor((m[2].length * 3) / 4); // base64 → byte estimate
  if (bytes === 0 || bytes > MAX_IMAGE_BYTES) return null;
  return v.trim();
}

// Sanitize an untrusted { groupName: string[] } map: known-shape only, ≤3 valid
// images per row, and a whole-quote byte budget so a crafted request can't bloat the
// DB/PDF. Empty result → caller stores NULL.
export function cleanLineImages(o: unknown): LineImages {
  const src = (o ?? {}) as Record<string, unknown>;
  const out: LineImages = {};
  let totalBytes = 0;
  for (const [group, arr] of Object.entries(src)) {
    if (!Array.isArray(arr)) continue;
    const imgs: string[] = [];
    for (const item of arr) {
      if (imgs.length >= MAX_IMAGES_PER_ROW) break;
      const ok = validImageDataUrl(item);
      if (!ok) continue;
      const bytes = Math.floor((ok.length * 3) / 4);
      if (totalBytes + bytes > MAX_TOTAL_IMAGE_BYTES) continue; // over budget: drop, don't fail
      totalBytes += bytes;
      imgs.push(ok);
    }
    const key = String(group).slice(0, 200);
    if (imgs.length) out[key] = imgs;
  }
  return out;
}

export function parseLineImages(json: string | null | undefined): LineImages {
  if (!json) return {};
  try { return cleanLineImages(JSON.parse(json)); } catch { return {}; }
}
export function serializeLineImages(o: unknown): string | null {
  const c = cleanLineImages(o);
  return Object.keys(c).length ? JSON.stringify(c) : null;
}

// Flatten the per-group image map to a single ordered list. The PDF (link targets)
// and the public serve endpoint both use THIS order, so a link's index N always
// resolves to the same image. Object insertion order is stable across JSON.parse +
// cleanLineImages, so both sides agree.
export function flattenLineImages(images: LineImages): string[] {
  const out: string[] = [];
  for (const arr of Object.values(images)) for (const s of arr) out.push(s);
  return out;
}
// Map each group to the GLOBAL indices of its images in the flattened order.
export function lineImageIndexByGroup(images: LineImages): Map<string, number[]> {
  const map = new Map<string, number[]>();
  let i = 0;
  for (const [group, arr] of Object.entries(images)) map.set(group, arr.map(() => i++));
  return map;
}

// Per-piece HSN (goods) / SAC (services) codes shown on the quotation, keyed by
// groupName. Codes are 4–8 digit numeric strings; the sanitizer strips non-digits and
// drops anything outside that length. Mirrors the LineImages storage pattern.
export type HsnByGroup = Record<string, string>;

export function cleanHsnByGroup(o: unknown): HsnByGroup {
  const src = (o ?? {}) as Record<string, unknown>;
  const out: HsnByGroup = {};
  let count = 0;
  for (const [group, raw] of Object.entries(src)) {
    if (count >= 500) break; // bound the map
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (digits.length < 4 || digits.length > 8) continue;
    out[String(group).slice(0, 200)] = digits;
    count++;
  }
  return out;
}
export function parseHsnByGroup(json: string | null | undefined): HsnByGroup {
  if (!json) return {};
  try { return cleanHsnByGroup(JSON.parse(json)); } catch { return {}; }
}
export function serializeHsnByGroup(o: unknown): string | null {
  const c = cleanHsnByGroup(o);
  return Object.keys(c).length ? JSON.stringify(c) : null;
}

// Per-piece quantity shown on the quotation, keyed by groupName. A positive integer
// (default 1); the piece's allocated selling price is divided by it to get a unit price.
// Mirrors the LineImages / HSN storage pattern.
export type QtyByGroup = Record<string, number>;

export function cleanQtyByGroup(o: unknown): QtyByGroup {
  const src = (o ?? {}) as Record<string, unknown>;
  const out: QtyByGroup = {};
  let count = 0;
  for (const [group, raw] of Object.entries(src)) {
    if (count >= 500) break;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n > 100_000) continue; // bounded; 1 is the default
    out[String(group).slice(0, 200)] = n;
    count++;
  }
  return out;
}
export function parseQtyByGroup(json: string | null | undefined): QtyByGroup {
  if (!json) return {};
  try { return cleanQtyByGroup(JSON.parse(json)); } catch { return {}; }
}
export function serializeQtyByGroup(o: unknown): string | null {
  const c = cleanQtyByGroup(o);
  return Object.keys(c).length ? JSON.stringify(c) : null;
}

// Per-piece GST RATE override (percent), keyed by groupName — for mixed-rate quotes
// (e.g. furniture at 18% + a component at 12%). A piece with no override uses the
// quote-level default rate. Bounded to 0–28 (the GST slab range). Mirrors the storage
// pattern of the other per-piece maps.
export type GstByGroup = Record<string, number>;

export function cleanGstByGroup(o: unknown): GstByGroup {
  const src = (o ?? {}) as Record<string, unknown>;
  const out: GstByGroup = {};
  let count = 0;
  for (const [group, raw] of Object.entries(src)) {
    if (count >= 500) break;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 28) continue;
    out[String(group).slice(0, 200)] = n;
    count++;
  }
  return out;
}
export function parseGstByGroup(json: string | null | undefined): GstByGroup {
  if (!json) return {};
  try { return cleanGstByGroup(JSON.parse(json)); } catch { return {}; }
}
export function serializeGstByGroup(o: unknown): string | null {
  const c = cleanGstByGroup(o);
  return Object.keys(c).length ? JSON.stringify(c) : null;
}

// GST state code → state/UT name (the leading 2 digits of a GSTIN). Used to print the
// Place of Supply on the quotation.
const GST_STATE_NAMES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "25": "Daman & Diu", "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
  "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};
export function gstStateName(code: string | null | undefined): string | null {
  return GST_STATE_NAMES[String(code ?? "").trim()] ?? null;
}

// Amount in words, Indian numbering (lakh/crore) — for the quotation total.
// 14750000 paise → "Indian Rupees One Lakh Forty Seven Thousand Five Hundred Only".
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const twoWords = (n: number): string => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`);
const threeWords = (n: number): string => { const h = Math.floor(n / 100), r = n % 100; return `${h ? ONES[h] + " Hundred" + (r ? " " : "") : ""}${r ? twoWords(r) : ""}`.trim(); };
function indianWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
  const lakh = Math.floor(n / 100_000); n %= 100_000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoWords(thousand)} Thousand`);
  if (n) parts.push(threeWords(n));
  return parts.join(" ");
}
export function amountInWords(paise: number): string {
  const p = Math.max(0, Math.round(paise));
  const rupees = Math.floor(p / 100);
  const paiseRem = p % 100;
  return `Indian Rupees ${indianWords(rupees)}${paiseRem ? ` and ${twoWords(paiseRem)} Paise` : ""} Only`;
}

export interface QuotationItem {
  name: string; // the piece (groupName)
  hsn?: string; // HSN/SAC code for this piece, if provided
  spec: string; // its components + dimensions, as a customer-readable spec
  quantity: number;
  unit: string;
  unitPricePaise: number; // ex-GST price per unit
  taxPct: number;
  taxPaise: number; // GST on this line
  amountPaise: number; // ex-GST + tax
  images: string[]; // up to 3 image data URLs for this piece (web view / previews)
  imageIndices: number[]; // global indices of this piece's images (PDF link targets + serve endpoint)
}

export interface QuotationView {
  items: QuotationItem[];
  totalQuantity: number;
  subTotalPaise: number; // Σ item amounts (incl. tax) — gross (pre-discount) + GST
  grossSubtotalPaise: number; // ex-GST list value BEFORE discount (Σ item unit prices)
  taxablePaise: number; // ex-GST taxable value AFTER discount (the GST base)
  gstPct: number; // the quote's default rate (a per-piece override may differ — see taxBands)
  interState: boolean; // true → GST charged as IGST; false → split CGST+SGST
  placeOfSupplyState: string | null; // resolved 2-digit GST state code (null if unknown)
  mixedRate: boolean; // true when pieces carry more than one GST rate
  taxBands: QuoteTaxBandView[]; // GST grouped by rate (one entry per distinct rate)
  cgstPaise: number; // Σ CGST across bands (0 when interState)
  sgstPaise: number; // Σ SGST across bands (0 when interState)
  igstPaise: number; // Σ IGST across bands (0 when NOT interState)
  discountPaise: number;
  grandTotalPaise: number; // taxable (post-discount) + gst
}

export interface QuoteTaxBandView {
  ratePct: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

// A GSTIN is 15 chars: 2-digit state code, 10-char PAN, entity digit, 'Z', checksum.
// Validating the full shape (not just the leading digits) stops a phone number or typo
// in the GSTIN field from being read as a state code — which would otherwise flip the
// intra-/inter-state (CGST/SGST vs IGST) tax decision. Case-insensitive on input.
const GSTIN_RE = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function isValidGstin(gstin: string | undefined | null): boolean {
  return GSTIN_RE.test(String(gstin ?? "").trim().toUpperCase());
}

// The 2-digit GST state code (e.g. "07" = Delhi) — only for a WELL-FORMED GSTIN, so an
// invalid value yields null (→ safe intra-state default) rather than a bogus state.
export function gstStateCode(gstin: string | undefined | null): string | null {
  return isValidGstin(gstin) ? String(gstin).trim().toUpperCase().slice(0, 2) : null;
}

// A bare 2-digit GST state code ("01".."38", "97", "99"), e.g. an explicit Place of
// Supply chosen in the builder. Returns null for anything else.
export function normalizeStateCode(code: string | undefined | null): string | null {
  const c = String(code ?? "").trim();
  return /^\d{2}$/.test(c) && gstStateName(c) ? c : null;
}

interface ViewLine {
  groupName: string;
  name: string;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  lineCostPaise: number;
}

const dimsOf = (l: ViewLine): string => {
  const parts = [l.lengthMm, l.widthMm, l.heightMm].filter((v): v is number => typeof v === "number" && v > 0);
  return parts.length ? `${parts.join(" × ")} mm` : "";
};

export interface TaxPiece {
  group: string;
  grossPaise: number; // ex-GST list price (pre-discount)
  netTaxablePaise: number; // ex-GST taxable value (post-discount) — the GST base
  ratePct: number; // this piece's GST rate (override else default)
  gstPaise: number; // GST on this piece (its share of its rate band)
}
export interface TaxBand {
  ratePct: number;
  taxablePaise: number;
  gstPaise: number;
}
export interface QuoteTax {
  order: string[];
  pieces: TaxPiece[];
  gstTotalPaise: number;
  bands: TaxBand[];
}

// THE shared tax core. Allocates the net (post-discount) taxable value across pieces by
// cost, assigns each its GST rate (per-piece override, else the default), and computes
// GST per RATE BAND (single-rounded via gstAmountPaise). A single-rate quote therefore
// yields exactly gstAmountPaise(netTotal, rate) — the pre-existing behaviour — while a
// mixed-rate quote sums the bands. buildQuotationView, serializeQuote and the BUSY
// voucher all call this, so their tax totals can never disagree.
export function computeQuoteTax(input: {
  lineItems: ViewLine[];
  netTotalPaise: number; // ex-GST, post-discount (q.totalPaise)
  discountPaise: number;
  defaultGstPct: number;
  gstByGroup?: GstByGroup;
}): QuoteTax {
  const gstByGroup = cleanGstByGroup(input.gstByGroup);
  const defaultRate = Math.max(0, Number(input.defaultGstPct) || 0);
  const discount = Math.max(0, Math.round(Number(input.discountPaise) || 0));
  const net = Math.max(0, Math.round(Number(input.netTotalPaise) || 0));
  const gross = net + discount;

  const order: string[] = [];
  const costByGroup = new Map<string, number>();
  for (const l of input.lineItems ?? []) {
    if (!costByGroup.has(l.groupName)) { costByGroup.set(l.groupName, 0); order.push(l.groupName); }
    costByGroup.set(l.groupName, costByGroup.get(l.groupName)! + Math.max(0, l.lineCostPaise));
  }
  const totalCost = order.reduce((s, g) => s + costByGroup.get(g)!, 0);

  // Allocate net + gross per piece by cost; remainder on the last piece so both sum exact.
  const pieces: TaxPiece[] = [];
  let allocNet = 0, allocGross = 0;
  order.forEach((group, i) => {
    const last = i === order.length - 1;
    const netTaxablePaise = last || totalCost <= 0 ? net - allocNet : Math.round((net * costByGroup.get(group)!) / totalCost);
    const grossPaise = last || totalCost <= 0 ? gross - allocGross : Math.round((gross * costByGroup.get(group)!) / totalCost);
    allocNet += netTaxablePaise; allocGross += grossPaise;
    pieces.push({ group, grossPaise, netTaxablePaise, ratePct: group in gstByGroup ? gstByGroup[group] : defaultRate, gstPaise: 0 });
  });

  // Degenerate: no line items → a single piece for the whole value.
  if (pieces.length === 0 && gross > 0) {
    order.push("Quotation");
    pieces.push({ group: "Quotation", grossPaise: gross, netTaxablePaise: net, ratePct: defaultRate, gstPaise: 0 });
  }

  // GST per rate band: sum taxable by rate, single-round each band (preserving the
  // single-rate invariant), then distribute each band's GST across its pieces exactly.
  const bandTaxable = new Map<number, number>();
  for (const p of pieces) bandTaxable.set(p.ratePct, (bandTaxable.get(p.ratePct) ?? 0) + p.netTaxablePaise);
  const bands: TaxBand[] = [...bandTaxable.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([ratePct, taxablePaise]) => ({ ratePct, taxablePaise, gstPaise: gstAmountPaise(taxablePaise, ratePct) }));
  for (const b of bands) {
    const inBand = pieces.filter((p) => p.ratePct === b.ratePct);
    let alloc = 0;
    inBand.forEach((p, j) => {
      p.gstPaise = j === inBand.length - 1 ? b.gstPaise - alloc : b.taxablePaise > 0 ? Math.round((b.gstPaise * p.netTaxablePaise) / b.taxablePaise) : 0;
      alloc += p.gstPaise;
    });
  }
  const gstTotalPaise = bands.reduce((s, b) => s + b.gstPaise, 0);
  return { order, pieces, gstTotalPaise, bands };
}

// Build the customer-facing quotation from the internal quote. The selling total is
// allocated across pieces proportional to their internal cost (the customer sees only
// the piece and its price). Pieces are shown at their pre-discount LIST price; the
// discount then reduces the taxable value and GST is charged on the POST-discount
// amount — the GST-compliant presentation (a discount at time of supply is excluded
// from taxable value). GST uses the shared gstAmountPaise on the post-discount total,
// the SAME formula the serializer / public view / BUSY export use, so the branded PDF's
// tax and grand total can never disagree with them.
export function buildQuotationView(q: {
  lineItems: ViewLine[];
  totalPaise: number; // ex-GST selling value, AFTER discount (the engine's stored total)
  discountPaise: number;
  gstPercent: number;
  images?: LineImages; // per-piece images keyed by groupName
  hsnByGroup?: HsnByGroup; // per-piece HSN/SAC codes keyed by groupName
  qtyByGroup?: QtyByGroup; // per-piece quantities keyed by groupName (default 1)
  gstByGroup?: GstByGroup; // per-piece GST rate overrides keyed by groupName (default rate)
  sellerGstin?: string | null; // issuer GSTIN — place of supply origin
  buyerGstin?: string | null; // customer GSTIN — determines intra- vs inter-state
  placeOfSupplyState?: string | null; // explicit ship-to state code — wins over buyer GSTIN
}): QuotationView {
  const images = cleanLineImages(q.images);
  const hsnByGroup = cleanHsnByGroup(q.hsnByGroup);
  const qtyByGroup = cleanQtyByGroup(q.qtyByGroup);
  const idxByGroup = lineImageIndexByGroup(images);
  const gstPct = Math.max(0, Number(q.gstPercent) || 0);
  const discountPaise = Math.max(0, Math.round(Number(q.discountPaise) || 0));
  const netTotal = Math.max(0, Math.round(Number(q.totalPaise) || 0)); // ex-GST, post-discount (the GST taxable value)
  const grossPaise = netTotal + discountPaise; // ex-GST list value, pre-discount

  // Per-piece net taxable, per-piece rate, and per-rate GST bands — the SHARED core the
  // serializer and BUSY voucher also use, so their tax totals can never disagree.
  const tax = computeQuoteTax({ lineItems: q.lineItems, netTotalPaise: netTotal, discountPaise, defaultGstPct: gstPct, gstByGroup: q.gstByGroup });

  // One customer line per piece = tax piece + its spec / qty / HSN / images.
  const linesByGroup = new Map<string, ViewLine[]>();
  for (const l of q.lineItems ?? []) { if (!linesByGroup.has(l.groupName)) linesByGroup.set(l.groupName, []); linesByGroup.get(l.groupName)!.push(l); }
  const items: QuotationItem[] = tax.pieces.map((p) => {
    const lines = linesByGroup.get(p.group) ?? [];
    const spec = lines.map((l) => { const d = dimsOf(l); return d ? `${l.name} (${d})` : l.name; }).join(", ");
    const qty = qtyByGroup[p.group] ?? 1;
    return { name: p.group, hsn: hsnByGroup[p.group], spec, quantity: qty, unit: "unit", unitPricePaise: Math.round(p.grossPaise / qty), taxPct: p.ratePct, taxPaise: p.gstPaise, amountPaise: p.grossPaise + p.gstPaise, images: images[p.group] ?? [], imageIndices: idxByGroup.get(p.group) ?? [] };
  });

  // Place of supply drives intra- vs inter-state. It's the explicit ship-to state when
  // set (covers B2C / unregistered buyers whose GSTIN doesn't carry it), else the buyer
  // GSTIN's state. Inter-state (→ IGST) only when it's known and differs from the seller's
  // state; otherwise intra-state (CGST+SGST) — the safe default.
  const sellerState = gstStateCode(q.sellerGstin);
  const placeOfSupplyState = normalizeStateCode(q.placeOfSupplyState) ?? gstStateCode(q.buyerGstin);
  const interState = !!sellerState && !!placeOfSupplyState && sellerState !== placeOfSupplyState;

  // Split each rate band into CGST/SGST (intra) or IGST (inter) for the summary.
  const taxBands: QuoteTaxBandView[] = tax.bands.map((b) => {
    const cg = interState ? 0 : Math.round(b.gstPaise / 2);
    return { ratePct: b.ratePct, taxablePaise: b.taxablePaise, cgstPaise: cg, sgstPaise: interState ? 0 : b.gstPaise - cg, igstPaise: interState ? b.gstPaise : 0 };
  });
  const cgstPaise = taxBands.reduce((s, b) => s + b.cgstPaise, 0);
  const sgstPaise = taxBands.reduce((s, b) => s + b.sgstPaise, 0);
  const igstPaise = taxBands.reduce((s, b) => s + b.igstPaise, 0);
  const subTotalPaise = items.reduce((s, it) => s + it.amountPaise, 0);

  return {
    items,
    totalQuantity: items.reduce((s, it) => s + it.quantity, 0),
    subTotalPaise,
    grossSubtotalPaise: grossPaise,
    taxablePaise: netTotal, // post-discount GST base
    gstPct,
    interState,
    placeOfSupplyState,
    mixedRate: tax.bands.length > 1,
    taxBands,
    cgstPaise,
    sgstPaise,
    igstPaise,
    discountPaise,
    grandTotalPaise: netTotal + tax.gstTotalPaise, // shared core → matches serializer/BUSY
  };
}
