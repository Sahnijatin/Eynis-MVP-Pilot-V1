import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveThemeMode } from "./theme-mode";

test("explicit dark cookie resolves to dark", () => {
  assert.equal(resolveThemeMode("dark"), "dark");
});

test("explicit light cookie resolves to light (wins over OS)", () => {
  assert.equal(resolveThemeMode("light"), "light");
});

test("no explicit choice honours the OS via the \"system\" stamp", () => {
  // Unset / unknown cookie → "system", so the @media block in globals.css drives
  // the theme from prefers-color-scheme (OS-default dark, enabled after the full
  // colour migration + categorical tint tail).
  for (const v of ["system", "", undefined, null, "garbage"]) {
    assert.equal(resolveThemeMode(v), "system", `value ${JSON.stringify(v)}`);
  }
});
