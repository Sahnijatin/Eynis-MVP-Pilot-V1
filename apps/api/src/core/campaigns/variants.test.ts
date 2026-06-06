import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { validateVariants, validateCampaignCreate, variantKeyForIndex } from "./service";
import { pickWeightedVariant } from "./worker";
import { summarizeVariant, decideLeaderN, type VariantRaw } from "./analytics";

// E-7: dynamic 1..N campaign variants.

// ── validateVariants ───────────────────────────────────────────────────────────

test("validateVariants assigns sequential keys and applies defaults", () => {
  const r = validateVariants(
    [
      { label: "Warm", voice: "Rachel", persona: "Warm", weight: 3 },
      { voice: "Aria", persona: "Direct" },
      { voice: "Bill", persona: "Formal" },
    ],
    { requireVoice: true },
  );
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.value.map((v) => v.key), ["A", "B", "C"]);
    assert.equal(r.value[0].weight, 3);
    assert.equal(r.value[1].weight, 1); // default
    assert.equal(r.value[1].label, "Direct"); // falls back to persona
  }
});

test("validateVariants requires voice + persona for the voice channel", () => {
  const r = validateVariants([{ label: "X" }], { requireVoice: true });
  assert.equal(r.ok, false);
});

test("validateVariants rejects empty and over-cap lists", () => {
  assert.equal(validateVariants([], { requireVoice: true }).ok, false);
  const many = Array.from({ length: 27 }, () => ({ voice: "v", persona: "p" }));
  assert.equal(validateVariants(many, { requireVoice: true }).ok, false);
});

test("variantKeyForIndex yields A..Z then falls back", () => {
  assert.equal(variantKeyForIndex(0), "A");
  assert.equal(variantKeyForIndex(25), "Z");
  assert.equal(variantKeyForIndex(26), "V27");
});

test("validateCampaignCreate accepts an explicit variants array (N arms)", () => {
  const r = validateCampaignCreate({
    name: "N-arm", scriptTemplate: "Hi",
    variants: [
      { voice: "Rachel", persona: "Warm" },
      { voice: "Aria", persona: "Direct" },
      { voice: "Bill", persona: "Formal" },
    ],
  });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.variants.length, 3);
    assert.deepEqual(r.value.variants.map((v) => v.key), ["A", "B", "C"]);
  }
});

test("validateCampaignCreate still accepts the legacy A/B fields", () => {
  const r = validateCampaignCreate({ name: "L", scriptTemplate: "Hi", voiceA: "Rachel", voiceB: "Aria", personaA: "E", personaB: "S" });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value.variants.map((v) => v.key), ["A", "B"]);
});

// ── weighted distribution ───────────────────────────────────────────────────────

test("pickWeightedVariant distributes proportionally to weight", () => {
  const variants = [
    { key: "A", vapiAssistantId: "a", weight: 3 },
    { key: "B", vapiAssistantId: "b", weight: 1 },
  ];
  const counts = new Map<string, number>([["A", 0], ["B", 0]]);
  const tally: Record<string, number> = { A: 0, B: 0 };
  for (let i = 0; i < 40; i++) {
    const k = pickWeightedVariant(variants, counts);
    tally[k]++;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // 3:1 weight over 40 picks → 30 / 10.
  assert.equal(tally.A, 30);
  assert.equal(tally.B, 10);
});

test("pickWeightedVariant spreads evenly across N equal arms", () => {
  const variants = ["A", "B", "C", "D"].map((key) => ({ key, vapiAssistantId: key, weight: 1 }));
  const counts = new Map<string, number>(variants.map((v) => [v.key, 0]));
  const tally: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (let i = 0; i < 40; i++) {
    const k = pickWeightedVariant(variants, counts);
    tally[k]++;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.deepEqual(tally, { A: 10, B: 10, C: 10, D: 10 });
});

// ── N-arm leader decision ────────────────────────────────────────────────────────

const raw = (over: Partial<VariantRaw>): VariantRaw => ({
  dials: 60, answered: 60, interested: 10, meetingsBooked: 5, avgDurationSeconds: 100, sentimentScoreSum: 0, sentimentRatedCount: 0, ...over,
});

test("decideLeaderN picks the highest interest-rate arm and gates on sample", () => {
  const arms = [
    { key: "A", stats: summarizeVariant(raw({ interested: 30 })) }, // 0.50
    { key: "B", stats: summarizeVariant(raw({ interested: 10 })) }, // 0.167
    { key: "C", stats: summarizeVariant(raw({ interested: 5 })) },  // 0.083
  ];
  const d = decideLeaderN(arms);
  assert.equal(d.leadingVariant, "A");
  assert.equal(d.sufficientSample, true);
  assert.equal(d.confident, true);
});

test("decideLeaderN treats a single variant as no test", () => {
  const d = decideLeaderN([{ key: "A", stats: summarizeVariant(raw({})) }]);
  assert.equal(d.confident, false);
  assert.match(d.sampleNote, /single variant/);
});

// ── integration: create with variants ─────────────────────────────────────────────

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

after(async () => { await prisma.$disconnect(); });

test("POST /campaigns persists N variant rows; GET returns them", async () => {
  const tenantId = "var-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "V " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
  const email = `o+${tenantId}@t.local`;
  await prisma.user.create({ data: { tenantId, fullName: "U", email, role: "owner", isActive: true } });

  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind");
  const base = "http://127.0.0.1:" + addr.port;
  try {
    const tok = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email, role: "owner" }) })
      .then((r) => r.json()).then((d: { token: string }) => d.token);

    const createRes = await fetch(base + "/campaigns", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok },
      body: JSON.stringify({
        name: "Three Arm", scriptTemplate: "Hi {lead.firstName}",
        variants: [
          { label: "Warm", voice: "Rachel", persona: "Warm", weight: 2 },
          { label: "Direct", voice: "Aria", persona: "Direct" },
          { label: "Formal", voice: "Bill", persona: "Formal" },
        ],
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { ok: boolean; campaign: { id: string; variants: Array<{ key: string; label: string; weight: number }> } };
    assert.equal(created.campaign.variants.length, 3);
    assert.deepEqual(created.campaign.variants.map((v) => v.key), ["A", "B", "C"]);
    assert.equal(created.campaign.variants[0].weight, 2);

    const getRes = await fetch(base + `/campaigns/${created.campaign.id}`, { headers: { authorization: "Bearer " + tok } });
    const got = (await getRes.json()) as { campaign: { variants: unknown[] } };
    assert.equal(got.campaign.variants.length, 3);
  } finally {
    await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  }
});
