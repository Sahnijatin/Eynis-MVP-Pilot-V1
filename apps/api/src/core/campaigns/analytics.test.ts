import test from "node:test";
import assert from "node:assert/strict";
import { summarizeVariant, twoProportionZ, decideLeader, sentimentScore, type VariantRaw } from "./analytics";

const raw = (over: Partial<VariantRaw> = {}): VariantRaw => ({
  dials: 80, answered: 52, interested: 12, meetingsBooked: 3, avgDurationSeconds: 187,
  sentimentScoreSum: 20, sentimentRatedCount: 52, ...over,
});

test("summarizeVariant computes funnel rates and avg sentiment", () => {
  const s = summarizeVariant(raw());
  assert.equal(s.answerRate, Number((52 / 80).toFixed(4)));
  assert.equal(s.interestRate, Number((12 / 52).toFixed(4)));
  assert.equal(s.bookingRate, Number((3 / 12).toFixed(4)));
  assert.equal(s.avgSentiment, Number((20 / 52).toFixed(3)));
});

test("rates are zero-safe when denominators are zero", () => {
  const s = summarizeVariant(raw({ dials: 0, answered: 0, interested: 0, sentimentRatedCount: 0 }));
  assert.equal(s.answerRate, 0);
  assert.equal(s.interestRate, 0);
  assert.equal(s.avgSentiment, 0);
});

test("twoProportionZ detects a clear difference and a null difference", () => {
  const big = twoProportionZ(40, 100, 10, 100); // 40% vs 10%
  assert.ok(Math.abs(big.z) > 2 && big.pValue < 0.05);
  const same = twoProportionZ(20, 100, 20, 100);
  assert.equal(same.z, 0);
  assert.equal(same.pValue, 1);
});

test("decideLeader gates on minimum sample per arm", () => {
  const a = summarizeVariant(raw({ answered: 10, interested: 5 }));
  const b = summarizeVariant(raw({ answered: 10, interested: 1 }));
  const d = decideLeader(a, b, 50);
  assert.equal(d.sufficientSample, false);
  assert.equal(d.confident, false);
  assert.match(d.sampleNote, /insufficient/);
});

test("decideLeader declares a confident winner with enough sample + significance", () => {
  const a = summarizeVariant(raw({ answered: 200, interested: 80 })); // 40%
  const b = summarizeVariant(raw({ answered: 200, interested: 20 })); // 10%
  const d = decideLeader(a, b, 50);
  assert.equal(d.sufficientSample, true);
  assert.equal(d.leadingVariant, "A");
  assert.equal(d.confident, true);
  assert.ok(d.pValue < 0.05);
});

test("sentimentScore maps labels", () => {
  assert.equal(sentimentScore("positive"), 1);
  assert.equal(sentimentScore("negative"), -1);
  assert.equal(sentimentScore("neutral"), 0);
  assert.equal(sentimentScore(null), 0);
});
