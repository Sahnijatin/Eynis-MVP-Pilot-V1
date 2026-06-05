import test from "node:test";
import assert from "node:assert/strict";
import { summarizeForecast, type ForecastDeal } from "./forecast";

const stage = (probability: number, id = "s" + probability, name = "S", order = probability) => ({ id, name, order, probability });

test("summarizeForecast: open value, weighted forecast and win rate", () => {
  const deals: ForecastDeal[] = [
    { value: 100000, expectedCloseAt: null, stage: stage(30) },
    { value: 200000, expectedCloseAt: null, stage: stage(60) },
    { value: null, expectedCloseAt: null, stage: stage(10) }, // null value contributes 0
  ];
  const f = summarizeForecast(deals, 3, 1, new Date("2026-06-05"));
  assert.equal(f.openCount, 3);
  assert.equal(f.openValue, 300000);
  // 100000*0.30 + 200000*0.60 + 0 = 30000 + 120000 = 150000
  assert.equal(f.weightedForecast, 150000);
  assert.equal(f.winRate, 0.75); // 3 / (3 + 1)
});

test("summarizeForecast: zero closed deals ⇒ win rate 0 (no divide-by-zero)", () => {
  const f = summarizeForecast([], 0, 0);
  assert.equal(f.winRate, 0);
  assert.equal(f.openValue, 0);
  assert.equal(f.weightedForecast, 0);
});

test("summarizeForecast: weighted value bucketed by expected-close period", () => {
  const now = new Date("2026-05-15T00:00:00Z"); // May → quarter Q2 ends 30 Jun
  const s = stage(50);
  const deals: ForecastDeal[] = [
    { value: 100000, expectedCloseAt: new Date("2026-05-20"), stage: s }, // this month + quarter
    { value: 200000, expectedCloseAt: new Date("2026-06-20"), stage: s }, // quarter only
    { value: 400000, expectedCloseAt: new Date("2026-07-20"), stage: s }, // neither
  ];
  const f = summarizeForecast(deals, 0, 0, now);
  // month: 100000*0.5 = 50000
  assert.equal(f.byPeriod.thisMonth, 50000);
  // quarter: (100000 + 200000)*0.5 = 150000
  assert.equal(f.byPeriod.thisQuarter, 150000);
});

test("summarizeForecast: byStage aggregates per stage, ordered", () => {
  const deals: ForecastDeal[] = [
    { value: 100000, expectedCloseAt: null, stage: { id: "a", name: "Qualified", order: 1, probability: 30 } },
    { value: 50000, expectedCloseAt: null, stage: { id: "a", name: "Qualified", order: 1, probability: 30 } },
    { value: 200000, expectedCloseAt: null, stage: { id: "b", name: "Lead In", order: 0, probability: 10 } },
  ];
  const f = summarizeForecast(deals, 0, 0);
  assert.equal(f.byStage.length, 2);
  assert.equal(f.byStage[0].stageName, "Lead In"); // ordered by stage.order
  assert.equal(f.byStage[1].stageName, "Qualified");
  assert.equal(f.byStage[1].count, 2);
  assert.equal(f.byStage[1].value, 150000);
  assert.equal(f.byStage[1].weighted, 45000); // 150000 * 0.3
});
