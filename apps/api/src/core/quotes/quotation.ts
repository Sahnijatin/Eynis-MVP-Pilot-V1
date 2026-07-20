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
}

export interface BillTo {
  name?: string;
  address?: string;
  pin?: string;
  phone?: string;
  gstin?: string;
}

const SELLER_KEYS: (keyof SellerDetails)[] = [
  "name", "address", "phone", "email", "gstin", "pan",
  "bankAccountName", "bankAccountNumber", "bankName", "bankBranch", "ifsc", "upi", "signatory",
];
const BILLTO_KEYS: (keyof BillTo)[] = ["name", "address", "pin", "phone", "gstin"];

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s ? s.slice(0, 400) : undefined; // cap to keep the snapshot bounded
};

// Sanitize an untrusted input object down to the known keys (drops anything else).
export function cleanSeller(o: unknown): SellerDetails {
  const src = (o ?? {}) as Record<string, unknown>;
  const out: SellerDetails = {};
  for (const k of SELLER_KEYS) { const v = str(src[k]); if (v) out[k] = v; }
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
  gstPct: number;
  interState: boolean; // true → GST charged as IGST; false → split CGST+SGST
  cgstPaise: number; // 0 when interState
  sgstPaise: number; // 0 when interState
  igstPaise: number; // 0 when NOT interState
  discountPaise: number;
  grandTotalPaise: number; // taxable (post-discount) + gst
}

// The 2-digit GST state code is the leading pair of a GSTIN (e.g. "07" = Delhi). Returns
// null when the value isn't a GSTIN with a leading numeric state code.
export function gstStateCode(gstin: string | undefined | null): string | null {
  const m = /^(\d{2})/.exec(String(gstin ?? "").trim());
  return m ? m[1] : null;
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
  sellerGstin?: string | null; // issuer GSTIN — place of supply origin
  buyerGstin?: string | null; // customer GSTIN — determines intra- vs inter-state
}): QuotationView {
  const images = cleanLineImages(q.images);
  const hsnByGroup = cleanHsnByGroup(q.hsnByGroup);
  const idxByGroup = lineImageIndexByGroup(images);
  const gstPct = Math.max(0, Number(q.gstPercent) || 0);
  const discountPaise = Math.max(0, Math.round(Number(q.discountPaise) || 0));
  const netTotal = Math.max(0, Math.round(Number(q.totalPaise) || 0)); // ex-GST, post-discount (the GST taxable value)
  const grossPaise = netTotal + discountPaise; // ex-GST list value, pre-discount

  // GST on the POST-discount taxable value, single-rounded via the shared formula so the
  // headline tax/total match the serializer, public view and BUSY voucher exactly.
  const gstTotal = gstAmountPaise(netTotal, gstPct);

  // Group the internal lines into pieces, preserving first-seen order.
  const order: string[] = [];
  const groups = new Map<string, ViewLine[]>();
  for (const l of q.lineItems ?? []) {
    if (!groups.has(l.groupName)) { groups.set(l.groupName, []); order.push(l.groupName); }
    groups.get(l.groupName)!.push(l);
  }
  const costByGroup = order.map((g) => groups.get(g)!.reduce((s, l) => s + Math.max(0, l.lineCostPaise), 0));
  const totalCost = costByGroup.reduce((s, c) => s + c, 0);

  const items: QuotationItem[] = [];
  let allocatedEx = 0; // Σ per-piece list price so far (must sum to grossPaise)
  let allocatedTax = 0; // Σ per-piece GST so far (must sum to gstTotal)
  order.forEach((group, i) => {
    const last = i === order.length - 1;
    // Per-piece LIST price allocated on the gross (pre-discount) value.
    const exTax = last || totalCost <= 0
      ? grossPaise - allocatedEx
      : Math.round((grossPaise * costByGroup[i]) / totalCost);
    allocatedEx += exTax;
    // Per-piece GST is a display allocation of the single-rounded headline gstTotal
    // (remainder on the last piece) so the per-line taxes sum EXACTLY to it.
    const tax = last ? gstTotal - allocatedTax : grossPaise > 0 ? Math.round((gstTotal * exTax) / grossPaise) : 0;
    allocatedTax += tax;
    const lines = groups.get(group)!;
    const spec = lines.map((l) => { const d = dimsOf(l); return d ? `${l.name} (${d})` : l.name; }).join(", ");
    items.push({ name: group, hsn: hsnByGroup[group], spec, quantity: 1, unit: "unit", unitPricePaise: exTax, taxPct: gstPct, taxPaise: tax, amountPaise: exTax + tax, images: images[group] ?? [], imageIndices: idxByGroup.get(group) ?? [] });
  });

  // Degenerate case (no line items): a single line for the whole quote.
  if (items.length === 0 && grossPaise > 0) {
    items.push({ name: "Quotation", spec: "", quantity: 1, unit: "unit", unitPricePaise: grossPaise, taxPct: gstPct, taxPaise: gstTotal, amountPaise: grossPaise + gstTotal, images: [], imageIndices: [] });
  }

  // Place of supply: inter-state ONLY when both GSTINs are known and their state codes
  // differ → GST is charged as a single IGST line. Otherwise intra-state (CGST+SGST),
  // which also covers the common case of an unregistered/unknown buyer (no GSTIN).
  const sellerState = gstStateCode(q.sellerGstin);
  const buyerState = gstStateCode(q.buyerGstin);
  const interState = !!sellerState && !!buyerState && sellerState !== buyerState;
  const igstPaise = interState ? gstTotal : 0;
  const cgstPaise = interState ? 0 : Math.round(gstTotal / 2);
  const sgstPaise = interState ? 0 : gstTotal - cgstPaise; // remainder on SGST so the two halves sum exactly
  const subTotalPaise = items.reduce((s, it) => s + it.amountPaise, 0);

  return {
    items,
    totalQuantity: items.reduce((s, it) => s + it.quantity, 0),
    subTotalPaise,
    grossSubtotalPaise: grossPaise,
    taxablePaise: netTotal, // post-discount GST base
    gstPct,
    interState,
    cgstPaise,
    sgstPaise,
    igstPaise,
    discountPaise,
    grandTotalPaise: netTotal + gstTotal, // === service.gstAmountPaise path
  };
}
