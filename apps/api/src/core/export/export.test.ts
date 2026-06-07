import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { seedDefaultRolesForHotel } from "../rbac";
import { csvCell, toCsvRows, brandedCsv } from "./csv";
import { renderBrandedReportHtml } from "./report-html";
import { renderBrandedReportPdf, isSafeLogoUrl } from "./report-pdf";
import { loadReportBrand, type ReportBrand } from "./brand";

// E-9 — branded PDF/CSV exports.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

after(async () => { await prisma.$disconnect(); });

const brand = (over: Partial<ReportBrand> = {}): ReportBrand => ({
  brandName: "Acme Cloud", primaryColor: "#123456", logoUrl: null, supportEmail: null,
  showPoweredBy: true, platformName: "Eynis", ...over,
});

// ── CSV ────────────────────────────────────────────────────────────────────────

test("csvCell quotes values with commas, quotes, or newlines", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('he said "hi"'), '"he said ""hi"""');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell(null), "");
});

test("toCsvRows joins with CRLF", () => {
  assert.equal(toCsvRows([["a", "b"], ["c", "d"]]), "a,b\r\nc,d");
});

test("csvCell defuses formula injection (leading = + - @) by prefixing an apostrophe", () => {
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("safe"), "safe");      // normal text untouched
  assert.equal(csvCell("a=b"), "a=b");         // = not leading → untouched
  // Leading "=" AND a comma → defused then RFC-quoted.
  assert.equal(csvCell("=a,b"), '"\'=a,b"');
});

test("isSafeLogoUrl blocks SSRF targets (non-https, private/loopback/metadata)", () => {
  assert.equal(isSafeLogoUrl("https://cdn.acme.com/logo.png"), true);
  for (const bad of [
    "http://cdn.acme.com/logo.png",            // not https
    "https://169.254.169.254/latest/meta-data",// cloud metadata
    "https://localhost/l.png",
    "https://10.0.0.5/l.png",
    "https://192.168.1.10/l.png",
    "https://172.16.4.4/l.png",
    "https://127.0.0.1/l.png",
    "https://db.internal/l.png",
    "not a url",
  ]) assert.equal(isSafeLogoUrl(bad), false, bad);
});

test("brandedCsv adds a brand preamble + drops 'powered by' for white_label", () => {
  const withPb = brandedCsv(brand({ supportEmail: "s@acme.com" }), "Report", { header: ["X"], rows: [["1"]] });
  assert.match(withPb, /Acme Cloud — Report/);
  assert.match(withPb, /Support,s@acme.com/);
  assert.match(withPb, /Powered by Eynis/);
  assert.match(withPb, /\r\nX\r\n1$/);

  const noPb = brandedCsv(brand({ showPoweredBy: false }), "Report", { header: ["X"], rows: [] });
  assert.doesNotMatch(noPb, /Powered by/);
});

// ── HTML report ─────────────────────────────────────────────────────────────────

test("renderBrandedReportHtml embeds brand, escapes content, and gates 'powered by'", () => {
  const html = renderBrandedReportHtml(brand({ supportEmail: "s@acme.com" }), {
    title: "Night Audit", blocks: [
      { kind: "headline", text: "All good <ok>", score: 9 },
      { kind: "list", heading: "Highlights", items: ["one & two"] },
    ],
  });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Acme Cloud/);
  assert.match(html, /#123456/);                 // brand color token
  assert.match(html, /&lt;ok&gt;/);              // headline escaped
  assert.match(html, /one &amp; two/);           // list item escaped
  assert.match(html, /Powered by Eynis/);
  assert.doesNotMatch(html, /All good <ok>/);    // raw angle brackets never emitted

  const wl = renderBrandedReportHtml(brand({ showPoweredBy: false }), { title: "T", blocks: [] });
  assert.doesNotMatch(wl, /Powered by/);
});

// ── PDF report (binary) ──────────────────────────────────────────────────────────

test("renderBrandedReportPdf produces a valid, non-trivial PDF and never throws on edge content", async () => {
  const bytes = await renderBrandedReportPdf(brand({ supportEmail: "s@acme.com" }), {
    title: "Night Audit", subtitle: "Report date: 2026-06-07", blocks: [
      { kind: "headline", text: "All good ".repeat(40), score: 9 },   // long → wraps + paginates
      { kind: "section", heading: "Executive Summary", body: "x".repeat(2000) },
      { kind: "list", heading: "Highlights", items: ["one & two", "<not html>"] },
      { kind: "list", heading: "Concerns", items: [] },               // empty list path
    ],
  });
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.byteLength > 800, "PDF should have real content");
  // PDF magic header "%PDF-" and EOF marker.
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("latin1"), "%PDF-");
  assert.match(Buffer.from(bytes).toString("latin1"), /%%EOF\s*$/);
});

test("renderBrandedReportPdf skips a broken logo URL without throwing", async () => {
  const bytes = await renderBrandedReportPdf(
    brand({ logoUrl: "https://127.0.0.1:1/nope.png" }),
    { title: "T", blocks: [{ kind: "section", heading: "H", body: "b" }] }
  );
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("latin1"), "%PDF-");
});

// ── Brand loading (DB) ───────────────────────────────────────────────────────────

async function seed(tier: string, branding?: { brandReports?: boolean; brandName?: string }) {
  const tenantId = "exp-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Tenant " + tenantId.slice(-4), timezone: "Asia/Kolkata", whitelabelTier: tier } });
  if (branding) {
    await prisma.tenantBranding.create({ data: { tenantId, brandName: branding.brandName ?? "BrandCo", primaryColor: "#0f766e", logoUrl: "https://cdn/x.png", brandReports: branding.brandReports ?? true } });
  }
  return tenantId;
}

test("loadReportBrand: white_label drops 'powered by'; standard keeps it", async () => {
  const std = await loadReportBrand(await seed("standard", { brandReports: true }));
  const wl = await loadReportBrand(await seed("white_label", { brandReports: true }));
  assert.equal(std.showPoweredBy, true);
  assert.equal(std.brandName, "BrandCo");
  assert.equal(wl.showPoweredBy, false);
});

test("loadReportBrand falls back to a neutral header when brandReports is off", async () => {
  const t = await seed("standard", { brandReports: false, brandName: "BrandCo" });
  const b = await loadReportBrand(t);
  assert.equal(b.logoUrl, null);          // no tenant logo
  assert.notEqual(b.brandName, "BrandCo"); // not the opted-out brand name
});

// ── Endpoint integration ─────────────────────────────────────────────────────────

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));

test("GET /service-requests/export returns a branded CSV attachment (auth required)", async () => {
  const tenantId = "exp-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Exporter " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await seedDefaultRolesForHotel(tenantId);
  const adminRole = await prisma.role.findFirst({ where: { tenantId, key: "admin" }, select: { id: true } });
  const email = `admin+${tenantId}@test.local`;
  await prisma.user.create({ data: { tenantId, fullName: "A", email, role: "owner", roleId: adminRole!.id, isActive: true } });

  const server = buildServer();
  const base = await listen(server);
  try {
    const tok = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email, roleKey: "admin" }) });
    const token = (await tok.json() as { token: string }).token;

    const noAuth = await fetch(base + "/service-requests/export");
    assert.equal(noAuth.status, 401);

    const r = await fetch(base + "/service-requests/export", { headers: { authorization: "Bearer " + token } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename="service-requests-/);
    const body = await r.text();
    assert.match(body, /Exporter/);                 // brand preamble
    assert.match(body, /ID,Contact,Category,Status/); // header row
  } finally { await close(server); }
});
