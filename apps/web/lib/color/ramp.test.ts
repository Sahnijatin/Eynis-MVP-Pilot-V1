import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAccentRamp, contrastRatio, hexToOklch, oklchToHex, relativeLuminance, accentRampToVars } from "./ramp";

// A deliberately hostile spread of hues: vivid, muted, dark, and the hard cases
// (yellow / cyan / lime) where naive ramps fail their text contrast on white.
const HUES: Record<string, string> = {
  indigo: "#5B5BD6", teal: "#0F766E", red: "#DC2626", amber: "#D97706",
  emerald: "#059669", cyan: "#06B6D4", magenta: "#DB2777", blue: "#2563EB",
  navy: "#1E3A5F", yellow: "#EAB308", gray: "#6B7280", orange: "#EA580C",
  lime: "#84CC16", violet: "#7C3AED",
};
const THEMES = ["light", "dark"] as const;
const isHex = (s: string) => /^#[0-9a-f]{6}$/.test(s);

test("every ramp yields 12 valid sRGB hex steps + a contrast colour, both themes", () => {
  for (const [name, hex] of Object.entries(HUES)) {
    for (const theme of THEMES) {
      const r = buildAccentRamp(hex, theme);
      assert.equal(r.steps.length, 12, `${name}/${theme}: 12 steps`);
      r.steps.forEach((s, i) => assert.ok(isHex(s), `${name}/${theme} step ${i + 1} valid hex: ${s}`));
      assert.ok(isHex(r.contrast), `${name}/${theme} contrast colour valid`);
    }
  }
});

test("accent text (step 11) clears WCAG AA (4.5:1) on the app background — ANY hue", () => {
  for (const [name, hex] of Object.entries(HUES)) {
    // light text sits on white surface; dark text sits on the dark app bg
    const light = buildAccentRamp(hex, "light");
    assert.ok(contrastRatio(light.steps[10], "#ffffff") >= 4.5,
      `${name}/light: --accent-text on #fff = ${contrastRatio(light.steps[10], "#ffffff").toFixed(2)}`);
    const dark = buildAccentRamp(hex, "dark");
    assert.ok(contrastRatio(dark.steps[10], "#0E0F14") >= 4.5,
      `${name}/dark: --accent-text on #0E0F14 = ${contrastRatio(dark.steps[10], "#0E0F14").toFixed(2)}`);
  }
});

test("high-contrast text (step 12) reaches 7:1 on the app background", () => {
  for (const [name, hex] of Object.entries(HUES)) {
    assert.ok(contrastRatio(buildAccentRamp(hex, "light").steps[11], "#ffffff") >= 7,
      `${name}/light step12`);
    assert.ok(contrastRatio(buildAccentRamp(hex, "dark").steps[11], "#0E0F14") >= 7,
      `${name}/dark step12`);
  }
});

test("on-solid contrast colour clears AA (4.5:1) on --accent-9 — so buttons are legible", () => {
  for (const [name, hex] of Object.entries(HUES)) {
    for (const theme of THEMES) {
      const r = buildAccentRamp(hex, theme);
      const ratio = contrastRatio(r.contrast, r.steps[8]);
      assert.ok(ratio >= 4.5, `${name}/${theme}: on-solid contrast = ${ratio.toFixed(2)} (${r.contrast} on ${r.steps[8]})`);
    }
  }
});

test("luminance progresses monotonically through the scale", () => {
  // Checked on the background/text regions (steps 1-8 + text) where ordering holds for
  // EVERY hue; the solid region (9-10) is intentionally excluded because intrinsically
  // light hues (yellow/lime) legitimately break luminance order there — contrast, not
  // luminance, is the guarantee for those steps (tested above).
  for (const [name, hex] of Object.entries(HUES)) {
    const lr = buildAccentRamp(hex, "light");
    const light = lr.steps.map(relativeLuminance);
    for (const [a, b] of [[0, 4], [4, 7]]) {
      assert.ok(light[a] > light[b], `${name}/light lum step${a + 1} > step${b + 1}`);
    }
    assert.ok(light[10] < light[0], `${name}/light: accent text darker than lightest bg`);
    // Step 12 is the high-contrast text: at least AAA (7:1), and never weaker than the
    // low-contrast step 11 — unless step 11 already overshoots into AAA itself (which
    // happens for hues that are intrinsically high-contrast on this ground).
    assert.ok(contrastRatio(lr.steps[11], "#ffffff") >= Math.min(7, contrastRatio(lr.steps[10], "#ffffff")) - 1e-6,
      `${name}/light: step12 ≥ step11 contrast (or step11 already AAA)`);

    const dr = buildAccentRamp(hex, "dark");
    const dark = dr.steps.map(relativeLuminance);
    for (const [a, b] of [[0, 4], [4, 7]]) {
      assert.ok(dark[a] < dark[b], `${name}/dark lum step${a + 1} < step${b + 1}`);
    }
    assert.ok(dark[10] > dark[0], `${name}/dark: accent text lighter than darkest bg`);
    assert.ok(contrastRatio(dr.steps[11], "#0E0F14") >= Math.min(7, contrastRatio(dr.steps[10], "#0E0F14")) - 1e-6,
      `${name}/dark: step12 ≥ step11 contrast (or step11 already AAA)`);
  }
});

test("step 9 (solid) is a usable button fill — ≥3:1 against its own tinted background (step 2)", () => {
  for (const [name, hex] of Object.entries(HUES)) {
    for (const theme of THEMES) {
      const r = buildAccentRamp(hex, theme);
      assert.ok(contrastRatio(r.steps[8], r.steps[1]) >= 3,
        `${name}/${theme}: solid vs bg = ${contrastRatio(r.steps[8], r.steps[1]).toFixed(2)}`);
    }
  }
});

test("determinism — same input yields the same ramp", () => {
  const a = buildAccentRamp("#5B5BD6", "light");
  const b = buildAccentRamp("#5B5BD6", "light");
  assert.deepEqual(a.steps, b.steps);
  assert.equal(a.contrast, b.contrast);
});

test("accentRampToVars exposes 12 steps, contrast, and the role aliases", () => {
  const vars = accentRampToVars(buildAccentRamp("#5B5BD6", "light"));
  for (let i = 1; i <= 12; i++) assert.ok(isHex(vars[`--accent-${i}`]), `--accent-${i}`);
  for (const k of ["--accent-contrast", "--accent-bg", "--accent-solid", "--accent-text", "--accent-focus", "--accent-border"]) {
    assert.ok(isHex(vars[k]), k);
  }
});

test("colour maths round-trips within tolerance", () => {
  for (const hex of Object.values(HUES)) {
    const back = oklchToHex(hexToOklch(hex));
    // per-channel within 2/255 after OKLab round-trip
    const p = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(p(hex, i) - p(back, i)) <= 2, `${hex} ch${i} → ${back}`);
  }
});
