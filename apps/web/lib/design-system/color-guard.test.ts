// ─────────────────────────────────────────────────────────────────────────────
// Design-system color guard (Phase 9)
//
// The repo lints with `tsc` and tests with node:test — there is no ESLint. This
// guard plays the "lint rule" role in the existing test runner: it scans every
// feature .tsx and FAILS if hardcoded colors that the token migration (Phases
// 4–8) eliminated reappear. It protects the invariant "components read semantic
// tokens, not raw shades" without adding a second linter.
//
// Two checks:
//   1. Tailwind numeric color utilities (bg-slate-500, text-red-600, …) — banned
//      except the documented Tier-B residual allowlist (on-dark rails / decorative
//      / stray categorical, pending the dark-QA + categorical passes).
//   2. Neutral hex in inline style — the exact shades Phase 8 replaced with tokens,
//      keyed by role so `color:"#fff"` (white text, legit) stays allowed while
//      `background:"#fff"` (should be --surface) is banned.
//
// When a check fails, migrate to the semantic token (see docs/design-system/
// tokens.md) or, for a genuine exception, add it to the allowlist WITH a reason.
// ─────────────────────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// cwd is apps/web when run via `npm run test -w @eynis/web`.
const ROOTS = ["app", "components"];

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (e.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(r)).sort();

// ── Check 1: Tailwind numeric color utilities ────────────────────────────────
const UTILITY_RE =
  /(?<![\w-])(bg|text|border|ring|divide|from|to|via|placeholder|fill|stroke|outline|accent)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?![\w-])/g;

// Documented Tier-B residual — on-dark rails, decorative, stray categorical.
// These are intentionally NOT migrated yet (dark-mode QA + categorical passes).
// Shrink this set as those land; never grow it for new light-surface colors.
const UTILITY_ALLOWLIST = new Set<string>([
  "text-slate-300", "text-slate-200",           // on the dark sidebar/hero rails
  "bg-slate-800", "bg-slate-700", "bg-slate-600",
  "bg-slate-500", "bg-slate-400", "bg-slate-300", // dark fills / VIP chips
  "border-slate-800",
  "text-teal-400", "text-teal-200", "text-teal-100", // decorative teal on dark
  "fill-amber-400", "ring-blue-100",              // stray categorical (Phase 7 tail)
]);

// Solid white/black surfaces/borders have no numeric shade, so the regex above
// misses them — but `bg-white` should be `bg-surface`, `bg-black`/`border-*` a
// token too. `text-white`/`text-black` (legit text colour) and translucent
// `/opacity` overlays (e.g. `bg-white/10` on dark) are allowed.
const WHITE_BLACK_RE = /(?<![\w-])(bg|border|divide|ring)-(white|black)(?![\w/-])/g;

test("no hardcoded Tailwind numeric color utilities (outside the Tier-B allowlist)", () => {
  const offenders: string[] = [];
  for (const f of FILES) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(UTILITY_RE)) {
      const cls = m[0];
      if (!UTILITY_ALLOWLIST.has(cls)) offenders.push(`${f}: ${cls}`);
    }
    for (const m of src.matchAll(WHITE_BLACK_RE)) offenders.push(`${f}: ${m[0]}`);
  }
  assert.equal(
    offenders.length, 0,
    `Hardcoded color utilities found — use a semantic token (bg-surface, text-fg-muted, ` +
    `bg-danger-bg, text-accent-text, bg-cat-1, …). See docs/design-system/tokens.md.\n` +
    offenders.map((o) => "  " + o).join("\n")
  );
});

// ── Check 2: neutral hex in inline style props (role-keyed) ───────────────────
const LIGHT_NEUTRAL_BG = /(?:\b(?:background|backgroundColor|bg|iconBg|badgeBg|tint))\s*:\s*"(#(?:fff|ffffff|f8fafc|fafafa|f1f5f9|f3f4f6|e2e8f0|e5e7eb|eee|ddd|d1d5db|cbd5e1))"/gi;
const DARK_NEUTRAL_TEXT = /\bcolor\s*:\s*"(#(?:0f172a|1e293b|334155|374151|475569|64748b|6b7280|666|94a3b8|9ca3af|888))"/gi;
const LIGHT_NEUTRAL_BORDER = /\bborder(?:Color)?\s*:\s*"[^"]*(#(?:e2e8f0|e5e7eb|eee|ddd|d1d5db|cbd5e1|f1f5f9))[^"]*"/gi;

test("no neutral hex in inline style — use surface/text/border tokens", () => {
  const offenders: string[] = [];
  for (const f of FILES) {
    const src = readFileSync(f, "utf8");
    for (const re of [LIGHT_NEUTRAL_BG, DARK_NEUTRAL_TEXT, LIGHT_NEUTRAL_BORDER]) {
      for (const m of src.matchAll(re)) offenders.push(`${f}: ${m[0].trim()}`);
    }
  }
  assert.equal(
    offenders.length, 0,
    `Neutral hex in inline style — use var(--surface|--surface-inset|--text|--text-muted|` +
    `--text-subtle|--border|--border-strong). color:"#fff" (white text) is fine; a light ` +
    `background/border or dark text hex is not.\n` +
    offenders.map((o) => "  " + o).join("\n")
  );
});
