import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveThemeMode } from "./theme-mode";

test("explicit dark cookie resolves to dark", () => {
  assert.equal(resolveThemeMode("dark"), "dark");
});

test("everything else defaults to light (safe until Phase 6 migration)", () => {
  for (const v of ["light", "system", "", undefined, null, "garbage"]) {
    assert.equal(resolveThemeMode(v), "light", `value ${JSON.stringify(v)}`);
  }
});
