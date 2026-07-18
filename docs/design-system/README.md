# Eynis Design System — token layer

This directory is the **single source of truth** for the visual language of `apps/web`.
It exists to replace three competing styling sources (ad‑hoc Tailwind color utilities,
hardcoded hex in `components/ds/tokens.ts`, and a handful of `--color-*` CSS variables in
`globals.css`) with **one semantic token layer** that every component reads from.

It is the foundation for the "combine three directions" frontend program:

| Direction | Role in the token layer | Owns |
|---|---|---|
| **08 · Industry‑Chromatic 2.0** | Foundation | The generated **12‑step OKLCH accent ramp** (`--accent-1..12`), AA‑guaranteed for any tenant brand hue |
| **02 · Fintech Trust** | Personality | The **neutral temperature (warm), ink‑navy text, type pairing, tabular numerals, elevation** |
| **07 · Adaptive Dual‑Tone** | Architecture | **Two value‑sets** (light + dark) for every token; semantic naming; theme switching |

They do not fight because they contribute to **different inputs of the same layer**. See
[`tokens.md`](./tokens.md) for the full contract and [`migration-map.md`](./migration-map.md)
for the old→new mapping that drives the migration.

## Resolution precedence

Every token resolves through this precedence (highest wins). All of it lands in the same
`--` custom properties, so components never need to know which layer won:

```
tenant white‑label override        (per‑tenant custom values, gated by tier)
  ▸ tenant brand hue               (feeds the generated accent ramp)
    ▸ personality constants        (02 — warm neutrals, ink text, type, elevation)
      ▸ base theme values          (07 — the light / dark value‑set)
```

## The one rule

**Never hardcode a color in `apps/web`.** No `text-slate-500`, no `bg-teal-700`, no `#0f172a`
in a `style={}`. Read a semantic token instead (`var(--text-muted)`, `var(--accent-solid)`).
Phase 9 adds an ESLint guard that enforces this; until then it is a review expectation.

## Status of this work

- **Phase 0 ✓** — token contract + migration map (this directory). *Docs only.*
- **Phase 1 ✓** — the OKLCH ramp generator (`lib/color/ramp.ts`) + AA contrast tests; injected
  additively as `--accent-1..12`.
- **Phase 2 ✓** — dual‑tone token values (both themes) in `globals.css`, SSR‑safe theme
  switching (`lib/theme-mode.ts`, cookie → `data-theme` on `<html>`), and a toggle gated behind
  `NEXT_PUBLIC_ENABLE_THEME_TOGGLE` until the migration completes. Defaults to light so OS‑dark
  users don't get a half‑migrated UI; the var‑driven shell flips today.
- Phase 3 — personality constants (warm neutrals, type, elevation): swap the **light** token
  values to the Fintech Trust spec in [`tokens.md`](./tokens.md).
- Phases 4–6 — migrate the DS primitives, `globals.css`, then the 62 feature files.
- Phases 7–9 — charts/categorical color, QA/a11y, rollout + lint guard.

Full phase plan lives in the project chat history / issue tracker; this README tracks the
contract those phases implement.
