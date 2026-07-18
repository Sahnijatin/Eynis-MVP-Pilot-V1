// Generated accent ramp (Design direction 08 — Industry-Chromatic 2.0).
//
// Turns a single tenant brand hue into a 12-step accent scale (Radix model) with
// role-stable steps, generated in OKLCH so the perceptual spacing is even and the
// same step means the same thing for every hue. The text steps (11-12) and the
// on-solid contrast colour are *contrast-derived*, so the ramp passes WCAG AA for
// ANY input hue by construction — proven in ramp.test.ts.
//
// Pure, dependency-free, deterministic. See docs/design-system/tokens.md.

export interface Oklch { L: number; C: number; h: number } // h in degrees
interface RGB { r: number; g: number; b: number }           // 0..1 (linear or srgb per context)

// ── hex <-> srgb ────────────────────────────────────────────────────────────
function parseHex(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function toHex(rgb: RGB): string {
  const c = (v: number) => {
    const x = Math.max(0, Math.min(255, Math.round(v * 255)));
    return x.toString(16).padStart(2, "0");
  };
  return "#" + c(rgb.r) + c(rgb.g) + c(rgb.b);
}

// ── sRGB gamma <-> linear ───────────────────────────────────────────────────
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// ── linear sRGB <-> OKLab (Björn Ottosson) ──────────────────────────────────
function linToOklab(r: number, g: number, b: number) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}
function oklabToLin(L: number, a: number, b: number): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  };
}

// ── public conversions ──────────────────────────────────────────────────────
export function hexToOklch(hex: string): Oklch {
  const s = parseHex(hex);
  const lab = linToOklab(toLinear(s.r), toLinear(s.g), toLinear(s.b));
  const C = Math.hypot(lab.a, lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L: lab.L, C, h };
}

const EPS = 1e-4;
function linInGamut(rgb: RGB): boolean {
  return rgb.r >= -EPS && rgb.r <= 1 + EPS && rgb.g >= -EPS && rgb.g <= 1 + EPS && rgb.b >= -EPS && rgb.b <= 1 + EPS;
}
function oklchToLin({ L, C, h }: Oklch): RGB {
  const hr = (h * Math.PI) / 180;
  return oklabToLin(L, C * Math.cos(hr), C * Math.sin(hr));
}

/** OKLCH → hex, reducing chroma (binary search) until the colour is inside the sRGB gamut. */
export function oklchToHex(col: Oklch): string {
  let lin = oklchToLin(col);
  if (!linInGamut(lin)) {
    let lo = 0, hi = col.C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (linInGamut(oklchToLin({ ...col, C: mid }))) lo = mid; else hi = mid;
    }
    lin = oklchToLin({ ...col, C: lo });
  }
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return toHex({ r: toGamma(clamp(lin.r)), g: toGamma(clamp(lin.g)), b: toGamma(clamp(lin.b)) });
}

// ── WCAG contrast ───────────────────────────────────────────────────────────
export function relativeLuminance(hex: string): number {
  const s = parseHex(hex);
  return 0.2126 * toLinear(s.r) + 0.7152 * toLinear(s.g) + 0.0722 * toLinear(s.b);
}
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ── the ramp ────────────────────────────────────────────────────────────────
export type Theme = "light" | "dark";

export interface AccentRamp {
  /** steps[0] = --accent-1 … steps[11] = --accent-12 */
  steps: string[];
  /** text colour for use ON --accent-9 (white or dark ink), AA-guaranteed */
  contrast: string;
}

// Perceptual lightness targets per step (1..10). Text steps 11-12 are derived.
const L_LIGHT = [0.992, 0.977, 0.954, 0.926, 0.894, 0.853, 0.796, 0.716, 0.610, 0.567];
const L_DARK  = [0.178, 0.213, 0.253, 0.293, 0.339, 0.395, 0.470, 0.560, 0.610, 0.670];
// Chroma as a fraction of the input's peak chroma, per step.
const C_LIGHT = [0.20, 0.35, 0.50, 0.62, 0.72, 0.80, 0.90, 1.00, 1.00, 0.97];
const C_DARK  = [0.22, 0.40, 0.55, 0.68, 0.78, 0.85, 0.92, 0.95, 1.00, 0.92];

const INK = "#141620";   // dark on-solid candidate
const WHITE = "#ffffff";

/** Search a lightness that reaches `target` contrast against `bg`, at fixed hue/chroma. */
function deriveText(h: number, C: number, bg: string, target: number, dir: "down" | "up"): string {
  let best = dir === "down" ? "#000000" : "#ffffff";
  // Scan perceptual L in fine steps; take the first that clears the target while
  // staying as close to the mid-tone as possible (most chromatic that still passes).
  const from = dir === "down" ? 0.62 : 0.70;
  const to   = dir === "down" ? 0.16 : 0.99;
  const step = dir === "down" ? -0.006 : 0.006;
  for (let L = from; dir === "down" ? L >= to : L <= to; L += step) {
    const hex = oklchToHex({ L, C, h });
    if (contrastRatio(hex, bg) >= target) { best = hex; break; }
    best = hex; // remember the most-extreme tried, as a fallback
  }
  return best;
}

/**
 * Build a 12-step accent ramp for a brand hue.
 * Steps 1-10 use fixed perceptual targets (gamut-clamped); 11-12 and the on-solid
 * contrast colour are derived to guarantee WCAG AA on the theme's app background.
 */
export function buildAccentRamp(brandHex: string, theme: Theme): AccentRamp {
  const base = hexToOklch(brandHex);
  const Lt = theme === "light" ? L_LIGHT : L_DARK;
  const Cf = theme === "light" ? C_LIGHT : C_DARK;
  const cPeak = Math.min(Math.max(base.C, 0.02), theme === "light" ? 0.20 : 0.19);

  const steps: string[] = [];
  for (let i = 0; i < 8; i++) steps.push(oklchToHex({ L: Lt[i], C: cPeak * Cf[i], h: base.h }));

  // Step 9 (solid) must carry legible text. Pick the better text side (white vs ink)
  // for a nominal solid, then nudge the solid's lightness until that text clears AA
  // (4.5:1). White text → darken the solid; dark text → lighten it. This keeps
  // coloured buttons genuinely accessible for every hue, even mid-luminance ones.
  const solidC = cPeak * Cf[8];
  let solidL = Lt[8];
  let solid = oklchToHex({ L: solidL, C: solidC, h: base.h });
  const preferWhite = contrastRatio(WHITE, solid) >= contrastRatio(INK, solid);
  const onSolid = preferWhite ? WHITE : INK;
  for (let i = 0; i < 48 && contrastRatio(onSolid, solid) < 4.5; i++) {
    solidL = Math.max(0.30, Math.min(0.94, solidL + (preferWhite ? -0.008 : 0.008)));
    solid = oklchToHex({ L: solidL, C: solidC, h: base.h });
  }
  steps.push(solid);
  // Step 10 (solid hover) derived from the adjusted solid so it tracks it.
  steps.push(oklchToHex({ L: solidL + (theme === "light" ? -0.045 : 0.055), C: solidC, h: base.h }));

  // Reference background the accent text sits on (strictest = lightest/darkest surface).
  const textBg = theme === "light" ? WHITE : "#0E0F14";
  const dir = theme === "light" ? "down" : "up";
  steps.push(deriveText(base.h, cPeak * 0.85, textBg, 4.5, dir)); // 11: low-contrast text (AA)
  steps.push(deriveText(base.h, cPeak * 0.55, textBg, 7.0, dir)); // 12: high-contrast text

  return { steps, contrast: onSolid };
}

/**
 * Flatten a ramp to CSS custom properties: --accent-1..12, --accent-contrast, and the
 * role aliases components use (so step numbers stay an implementation detail).
 */
export function accentRampToVars(ramp: AccentRamp, prefix = "--accent"): Record<string, string> {
  const v: Record<string, string> = {};
  ramp.steps.forEach((hex, i) => { v[`${prefix}-${i + 1}`] = hex; });
  v[`${prefix}-contrast`] = ramp.contrast;
  // aliases (see tokens.md §4)
  v[`${prefix}-bg`] = ramp.steps[2];
  v[`${prefix}-bg-hover`] = ramp.steps[3];
  v[`${prefix}-line`] = ramp.steps[5];
  v[`${prefix}-border`] = ramp.steps[6];
  v[`${prefix}-focus`] = ramp.steps[7];
  v[`${prefix}-solid`] = ramp.steps[8];
  v[`${prefix}-solid-hover`] = ramp.steps[9];
  v[`${prefix}-text`] = ramp.steps[10];
  return v;
}
