import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { wrapBrandedEmail, loadEmailBrand, type EmailBrand } from "./branding";

// E-9 — branded email chrome + tier-gated "powered by".

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

after(async () => { await prisma.$disconnect(); });

const brand = (over: Partial<EmailBrand> = {}): EmailBrand => ({
  brandName: "Acme Cloud", primaryColor: "#123456", logoUrl: null, supportEmail: null, showPoweredBy: true, ...over,
});

test("wrapBrandedEmail embeds the brand name and body", () => {
  const html = wrapBrandedEmail("<p>Hello</p>", brand());
  assert.match(html, /Acme Cloud/);
  assert.match(html, /<p>Hello<\/p>/);
  assert.match(html, /#123456/); // brand color in header
});

test("wrapBrandedEmail shows 'Powered by' only when showPoweredBy is true", () => {
  assert.match(wrapBrandedEmail("x", brand({ showPoweredBy: true })), /Powered by/);
  assert.doesNotMatch(wrapBrandedEmail("x", brand({ showPoweredBy: false })), /Powered by/);
});

test("wrapBrandedEmail escapes the brand name (no HTML injection)", () => {
  const html = wrapBrandedEmail("body", brand({ brandName: '<script>x</script>' }));
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("wrapBrandedEmail uses the logo when provided, with a support line", () => {
  const html = wrapBrandedEmail("body", brand({ logoUrl: "https://cdn.acme.com/l.png", supportEmail: "help@acme.com" }));
  assert.match(html, /cdn\.acme\.com\/l\.png/);
  assert.match(html, /help@acme.com/);
});

async function seedTenant(tier: string, branding?: { brandEmails?: boolean }) {
  const tenantId = "eb-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Acme " + tenantId.slice(-4), timezone: "Asia/Kolkata", whitelabelTier: tier } });
  if (branding) {
    await prisma.tenantBranding.create({ data: { tenantId, brandName: "Acme", primaryColor: "#0f766e", brandEmails: branding.brandEmails ?? true } });
  }
  return tenantId;
}

test("loadEmailBrand: standard tier keeps 'powered by'; white_label drops it", async () => {
  const std = await seedTenant("standard");
  const wl = await seedTenant("white_label");
  const stdBrand = await loadEmailBrand(std);
  const wlBrand = await loadEmailBrand(wl);
  assert.equal(stdBrand?.showPoweredBy, true);
  assert.equal(wlBrand?.showPoweredBy, false);
});

test("loadEmailBrand returns null when the tenant disabled email brand chrome", async () => {
  const t = await seedTenant("standard", { brandEmails: false });
  assert.equal(await loadEmailBrand(t), null);
});
