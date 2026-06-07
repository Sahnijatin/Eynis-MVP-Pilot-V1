import { test } from "node:test";
import assert from "node:assert/strict";

import { validateTemplateDef, LIMITS } from "./types";
import { htmlToText } from "./sources/crawl";
import { buildReportBlocks, buildReportCsv } from "./render";
import { synthesize } from "./synthesize";
import type { GatherResult } from "./gather";
import { BUILTIN_TEMPLATES } from "./templates";

// ── validateTemplateDef ───────────────────────────────────────────────────────
test("validateTemplateDef rejects a template with no name", () => {
  const r = validateTemplateDef({ sections: [{ title: "X" }], sources: { crawl: { enabled: true } } });
  assert.equal(r.ok, false);
});

test("validateTemplateDef rejects a template with no sections", () => {
  const r = validateTemplateDef({ name: "T", sources: { crawl: { enabled: true } }, sections: [] });
  assert.equal(r.ok, false);
});

test("validateTemplateDef rejects a template with no enabled source", () => {
  const r = validateTemplateDef({ name: "T", sources: {}, sections: [{ title: "S" }] });
  assert.equal(r.ok, false);
});

test("validateTemplateDef accepts a valid template and clamps maxPages", () => {
  const r = validateTemplateDef({
    name: "Good",
    subjectType: "deal",
    inputs: [{ key: "we!rd key", label: "Web" }],
    sources: { crawl: { enabled: true, seeds: ["{website}"], maxPages: 999 } },
    sections: [{ title: "Overview", outputs: ["text", "bogus", "score"] }],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.def.subjectType, "deal");
  assert.equal(r.def.sources.crawl?.maxPages, LIMITS.maxPages); // clamped
  assert.equal(r.def.inputs[0]?.key, "werdkey"); // sanitized
  assert.deepEqual(r.def.sections[0]?.outputs, ["text", "score"]); // bogus output dropped
});

// ── htmlToText ────────────────────────────────────────────────────────────────
test("htmlToText strips scripts/styles/markup and decodes entities", () => {
  const html = "<html><head><style>.a{}</style><script>bad()</script></head><body><h1>Hi &amp; Bye</h1><p>Body text</p></body></html>";
  const text = htmlToText(html);
  assert.ok(!text.includes("bad()"));
  assert.ok(!text.includes(".a{}"));
  assert.ok(text.includes("Hi & Bye"));
  assert.ok(text.includes("Body text"));
});

// ── render ────────────────────────────────────────────────────────────────────
test("buildReportBlocks emits a headline, sections and tables", () => {
  const result = {
    sections: [
      { id: "s1", title: "Overview", content: "Prose paragraph.", table: null, score: null },
      { id: "s2", title: "Fit", content: "- one\n- two\n- three", table: { headers: ["A"], rows: [["1"]] }, score: 80 },
    ],
    score: 80,
    usage: { provider: "claude", llmCalls: 0, usedAI: false, sourcesFetched: 0 },
  };
  const blocks = buildReportBlocks({ title: "T", subject: "Acme", score: 80, result });
  assert.equal(blocks[0]?.kind, "headline");
  assert.ok(blocks.some((b) => b.kind === "list")); // bulleted section → list
  assert.ok(blocks.some((b) => b.kind === "table"));

  const csv = buildReportCsv(result);
  assert.equal(csv.header.length, 3);
  assert.equal(csv.rows.length, 2);
});

// ── synthesize fallback (no AI configured) ────────────────────────────────────
test("synthesize produces a complete report via deterministic fallback when AI is off", async () => {
  // No ANTHROPIC_API_KEY / OPENAI_API_KEY in the test env → AI_AVAILABLE is false,
  // so synthesize must still return one section per template section (no network).
  const def = {
    name: "Profile",
    subjectType: "company" as const,
    inputs: [],
    sources: { crawl: { enabled: true } },
    sections: [
      { id: "a", title: "Overview", prompt: "p", outputs: ["text"] as Array<"text"> },
      { id: "b", title: "Score", prompt: "p", outputs: ["score"] as Array<"score">, weight: 100 },
    ],
  };
  const gathered: GatherResult = {
    sources: [{ kind: "search", title: "Acme news", url: "https://x.test", snippet: "..." }],
    summary: "WEB SEARCH RESULTS:\n- Acme news",
    fetchedCount: 1,
  };
  const out = await synthesize(def, "Acme", gathered);
  assert.equal(out.sections.length, 2);
  assert.equal(out.usage.usedAI, false);
  assert.equal(typeof out.sections[0]?.content, "string");
  assert.equal(typeof out.score, "number"); // score section produced a fallback number
});

// ── built-ins are internally valid ────────────────────────────────────────────
test("every built-in template passes validation", () => {
  for (const b of BUILTIN_TEMPLATES) {
    const r = validateTemplateDef(b.def);
    assert.equal(r.ok, true, `${b.id} should be valid`);
  }
});
