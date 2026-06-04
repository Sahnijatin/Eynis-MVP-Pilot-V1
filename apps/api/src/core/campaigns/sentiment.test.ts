import test from "node:test";
import assert from "node:assert/strict";
import { classifySentiment, aggregateSentiment } from "./sentiment";

test("classifySentiment labels positive / negative / neutral", () => {
  assert.equal(classifySentiment("Yes that sounds great, definitely interested").sentiment, "positive");
  assert.equal(classifySentiment("No, not interested, please stop").sentiment, "negative");
  assert.equal(classifySentiment("I am at the office right now").sentiment, "neutral");
  assert.equal(classifySentiment("").sentiment, "neutral");
});

test("classifySentiment score is bounded and signed", () => {
  assert.ok(classifySentiment("great perfect love").score > 0.2);
  assert.ok(classifySentiment("terrible hate waste").score < -0.2);
});

test("aggregateSentiment averages the timeline", () => {
  assert.equal(aggregateSentiment([]).sentiment, "neutral");
  assert.equal(aggregateSentiment([1, 1, 0.5]).sentiment, "positive");
  assert.equal(aggregateSentiment([-1, -0.5]).sentiment, "negative");
});
