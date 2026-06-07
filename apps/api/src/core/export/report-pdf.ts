// Real (binary) branded PDF report (E-9). Uses pdf-lib — pure-TS, no native deps,
// standard fonts built in — so we emit an actual application/pdf, not a print page.
// The tenant brand (logo best-effort + name on the brand color, support contact)
// heads the document; the "powered by" footer is dropped for white_label tenants.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { ReportBlock } from "./report-html";
import type { ReportBrand } from "./brand";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const CONTENT_W = A4[0] - MARGIN * 2;

const hexToRgb = (hex: string): RGB => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return rgb(0.06, 0.46, 0.43); // fallback teal
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
};

// Greedy word-wrap to a pixel width using the font's own metrics.
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of String(text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (cur && font.widthOfTextAtSize(test, size) > maxWidth) { out.push(cur); cur = w; }
      else cur = test;
    }
    out.push(cur);
  }
  return out.length ? out : [""];
}

// Rejects URLs that could be used for SSRF when we fetch the logo server-side:
// only https, and never a private/loopback/link-local host (incl. cloud metadata
// at 169.254.169.254). A best-effort host check — the redirect:"error" below also
// stops a public host from bouncing us to an internal one.
export function isSafeLogoUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  // Block literal private/loopback/link-local IPs.
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

// Best-effort logo embed: https public host only, PNG/JPG, no redirects, short
// timeout, never throws.
async function tryEmbedLogo(doc: PDFDocument, url: string | null) {
  if (!url || !/\.(png|jpe?g)(\?.*)?$/i.test(url) || !isSafeLogoUrl(url)) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "error" }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 5_000_000) return null; // cap embed size
    return /\.png(\?.*)?$/i.test(url) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch { return null; }
}

export async function renderBrandedReportPdf(
  brand: ReportBrand,
  opts: { title: string; subtitle?: string; generatedAt?: Date; blocks: ReportBlock[] }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const brandColor = hexToRgb(brand.primaryColor);
  const ink = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.45, 0.5, 0.56);
  const logo = await tryEmbedLogo(doc, brand.logoUrl);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1];

  const newPage = () => { page = doc.addPage(A4); y = A4[1]; };
  const ensure = (h: number) => { if (y - h < MARGIN + 24) newPage(); };

  // ── Brand header bar ──────────────────────────────────────────────────────
  const headerH = 64;
  page.drawRectangle({ x: 0, y: A4[1] - headerH, width: A4[0], height: headerH, color: brandColor });
  if (logo) {
    const lh = 34, lw = (logo.width / logo.height) * lh;
    page.drawImage(logo, { x: MARGIN, y: A4[1] - headerH + (headerH - lh) / 2, width: Math.min(lw, 180), height: lh });
  } else {
    page.drawText(brand.brandName, { x: MARGIN, y: A4[1] - headerH / 2 - 7, size: 18, font: bold, color: rgb(1, 1, 1) });
  }
  y = A4[1] - headerH - 28;

  // ── Title + meta ──────────────────────────────────────────────────────────
  page.drawText(opts.title, { x: MARGIN, y, size: 20, font: bold, color: ink });
  y -= 18;
  const metaBits = [
    opts.subtitle,
    `Generated ${(opts.generatedAt ?? new Date()).toLocaleString("en-IN")}`,
    brand.supportEmail ? `Support: ${brand.supportEmail}` : null
  ].filter(Boolean) as string[];
  page.drawText(metaBits.join("   ·   "), { x: MARGIN, y, size: 9, font, color: muted });
  y -= 22;

  const text = (s: string, size: number, f: PDFFont, color: RGB, gap = 4) => {
    for (const line of wrapLines(s, f, size, CONTENT_W)) {
      ensure(size + gap);
      page.drawText(line, { x: MARGIN, y, size, font: f, color });
      y -= size + gap;
    }
  };

  for (const block of opts.blocks) {
    if (block.kind === "headline") {
      ensure(60);
      // Headline panel with a big score on the right.
      const panelTop = y;
      const lines = wrapLines(block.text, bold, 13, CONTENT_W - 90);
      const panelH = Math.max(48, lines.length * 17 + 22);
      page.drawRectangle({ x: MARGIN, y: panelTop - panelH, width: CONTENT_W, height: panelH, color: rgb(0.97, 0.98, 0.99), borderColor: rgb(0.89, 0.91, 0.94), borderWidth: 1 });
      let ly = panelTop - 18;
      for (const line of lines) { page.drawText(line, { x: MARGIN + 14, y: ly, size: 13, font: bold, color: ink }); ly -= 17; }
      if (typeof block.score === "number") {
        page.drawText(String(block.score), { x: A4[0] - MARGIN - 56, y: panelTop - panelH / 2 - 6, size: 30, font: bold, color: brandColor });
        page.drawText("/ 10", { x: A4[0] - MARGIN - 54, y: panelTop - panelH / 2 - 22, size: 9, font, color: muted });
      }
      y = panelTop - panelH - 18;
      continue;
    }
    // Section / list heading.
    ensure(28);
    page.drawText(block.heading.toUpperCase(), { x: MARGIN, y, size: 10, font: bold, color: brandColor });
    y -= 16;
    if (block.kind === "section") {
      text(block.body || "—", 11, font, ink, 5);
    } else {
      if (!block.items.length) text("None.", 11, font, muted, 5);
      for (const item of block.items) {
        const lines = wrapLines(item, font, 11, CONTENT_W - 14);
        lines.forEach((line, i) => {
          ensure(16);
          page.drawText(i === 0 ? "•" : " ", { x: MARGIN, y, size: 11, font, color: brandColor });
          page.drawText(line, { x: MARGIN + 14, y, size: 11, font, color: ink });
          y -= 16;
        });
      }
    }
    y -= 8;
  }

  // ── Footer ("powered by" unless white_label) ──────────────────────────────
  if (brand.showPoweredBy) {
    const fp = doc.getPages()[doc.getPageCount() - 1];
    fp.drawText(`Powered by ${brand.platformName}`, { x: MARGIN, y: MARGIN - 18, size: 8, font, color: muted });
  }

  return doc.save();
}
