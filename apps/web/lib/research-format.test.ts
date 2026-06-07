import { test } from "node:test";
import assert from "node:assert/strict";

import { splitSectionContent, usageSummary } from "./research-format";

test("splitSectionContent renders mostly-bulleted content as a list", () => {
  const r = splitSectionContent("- one\n- two\n- three");
  assert.equal(r.kind, "list");
  if (r.kind === "list") assert.deepEqual(r.items, ["one", "two", "three"]);
});

test("splitSectionContent keeps prose as text", () => {
  const r = splitSectionContent("This is a paragraph of prose with no bullets at all.");
  assert.equal(r.kind, "text");
});

test("splitSectionContent handles numbered lists", () => {
  const r = splitSectionContent("1. first\n2. second");
  assert.equal(r.kind, "list");
  if (r.kind === "list") assert.deepEqual(r.items, ["first", "second"]);
});

test("usageSummary describes an AI run", () => {
  const s = usageSummary({ usedAI: true, llmCalls: 4, provider: "claude", sourcesFetched: 6, cacheHits: 2, durationMs: 42000 });
  assert.match(s, /4 AI calls \(claude\)/);
  assert.match(s, /6 sources/);
  assert.match(s, /2 cached/);
  assert.match(s, /42\.0s/);
});

test("usageSummary describes a fallback run", () => {
  const s = usageSummary({ usedAI: false, sourcesFetched: 1 });
  assert.match(s, /no-AI fallback/);
});

test("usageSummary tolerates null", () => {
  assert.equal(usageSummary(null), "");
});
