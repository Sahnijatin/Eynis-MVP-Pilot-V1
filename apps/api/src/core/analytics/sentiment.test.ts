import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { computeSentimentAnalytics } from "./sentiment";

// F-17: sentiment analytics are now computed from real SentimentEvent +
// ConnectorEvent data instead of Math.random()/hard-coded values.
const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const makeTenant = async () => {
  const tenantId = "sent-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "S " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  return tenantId;
};
after(async () => { await prisma.$disconnect(); });

test("returns genuine zeros when there is no sentiment data", async () => {
  const tenantId = await makeTenant();
  const r = await computeSentimentAnalytics(tenantId);
  assert.equal(r.totalFeedback, 0);
  assert.equal(r.netScore, 0);
  assert.deepEqual(r.breakdown, { positive: 0, neutral: 0, negative: 0 });
  assert.equal(r.surveyCompletionRate, null); // never fabricated
  assert.equal(r.drivers.length, 0);
  assert.equal(r.timeSeries.length, 30);
  assert.ok(r.timeSeries.every((p) => p.score === null));
});

test("aggregates voice SentimentEvents and inbound ConnectorEvents (F-17)", async () => {
  const tenantId = await makeTenant();
  await prisma.sentimentEvent.createMany({
    data: [
      { tenantId, speaker: "customer", text: "the room was lovely and clean", sentiment: "positive", score: 85 },
      { tenantId, speaker: "customer", text: "lovely staff lovely view", sentiment: "positive", score: 80 },
      { tenantId, speaker: "customer", text: "the noise was terrible", sentiment: "negative", score: 25 },
      { tenantId, speaker: "agent", text: "how can I help", sentiment: "neutral", score: 55 }, // agent → excluded
    ],
  });
  await prisma.connectorEvent.create({
    data: { tenantId, connectorKey: "whatsapp_twilio", rawPayload: "{}", aiSentiment: "negative" },
  });

  const r = await computeSentimentAnalytics(tenantId);

  // 2 positive + 1 negative (customer voice) + 1 negative (inbound) = breakdown.
  assert.equal(r.breakdown.positive, 2);
  assert.equal(r.breakdown.negative, 2);
  assert.equal(r.breakdown.neutral, 0); // agent utterance excluded
  assert.equal(r.totalFeedback, 4);
  // netScore = ((2-2)/4)*50 + 50 = 50
  assert.equal(r.netScore, 50);
  assert.deepEqual(r.bySource, [{ source: "Voice calls", count: 3 }, { source: "Inbound messages", count: 1 }]);
  // "lovely" recurs in positive snippets → should surface as a positive driver.
  assert.ok(r.drivers.some((d) => d.term === "lovely" && d.sentiment === "positive"));
  // negative outweighs? here equal → no alert
  assert.equal(r.alert, null);
});
