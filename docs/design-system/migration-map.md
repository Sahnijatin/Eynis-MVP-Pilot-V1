# Color migration map

The old→new mapping that drives Phases 4–6. Every hardcoded color utility and hex in
`apps/web` maps to a semantic token from [`tokens.md`](./tokens.md). The machine‑readable
form is [`color-map.json`](./color-map.json) (consumed by the Phase 6 codemod); this file is
the human rationale + the edge cases that need a human.

## Audit snapshot (baseline for scope tracking)

Captured on the `main` head this branch was cut from. Re‑run the commands to measure progress.

| Metric | Count |
|---|---|
| Files using hardcoded Tailwind color utilities | **62** |
| Total color‑utility occurrences | **~1,341** |
| Hardcoded hex in `.ts`/`.tsx` | **~642** |
| Existing `--color-*` vars in `globals.css` | 10 |

```bash
# files
grep -rlE '(bg|text|border|ring)-(slate|gray|teal|red|amber|emerald|blue|indigo|cyan|purple|orange)-[0-9]' apps/web/components apps/web/app --include=*.tsx | wc -l
# occurrences
grep -rhoE '(bg|text|border|ring|from|to|via|divide|fill|stroke|outline)-(slate|gray|zinc|neutral|stone|teal|cyan|emerald|green|blue|indigo|violet|purple|amber|yellow|orange|red|rose|pink)-[0-9]{2,3}' apps/web/components apps/web/app --include=*.tsx | wc -l
# hex
grep -roE '#[0-9a-fA-F]{6}' apps/web/components apps/web/app apps/web/lib --include=*.tsx --include=*.ts | wc -l
```

Definition of done for the migration: **both `grep` counts reach 0** in `apps/web`
(excluding this `docs/` tree and the intentional inputs listed in §Keep).

## The mapping is role‑based, not shade‑based

The whole point is to encode **meaning**, not a shade. So `text-slate-500` (a muted label)
and `text-slate-600` (slightly darker) both become `--text-muted`, even though their exact
lightness differs by a hair. Minor per‑pixel drift is expected and desirable — it makes the UI
*more* consistent. Where a shade carries real intent that the 3‑tier text scale can't hold,
it's flagged **⚠ manual** below.

## Neutrals → text / surface / border tiers

| Old utility(ies) | → Token | Notes |
|---|---|---|
| `text-slate-900` `text-slate-800` `text-gray-900` | `--text` | primary/heading |
| `text-slate-700` | `--text` | dark body = primary |
| `text-slate-600` `text-slate-500` `text-gray-500` | `--text-muted` | dominant muted (345+99 uses) |
| `text-slate-400` | `--text-subtle` | captions/meta |
| `text-slate-300` `text-slate-200` | `--text-faint` | placeholder/disabled ⚠ some are on‑dark, check |
| `bg-white` | `--surface` | cards/panels |
| `bg-slate-50` | `--surface-inset` | hover/well/zebra |
| `bg-slate-100` `bg-slate-200` | `--surface-inset` | ⚠ `-200` sometimes a fill, check |
| `border-slate-50` `border-slate-100` `border-slate-200` | `--border` | hairline |
| `border-slate-300` | `--border-strong` | inputs/emphasis |

## Accent (teal → generated ramp)

| Old | → Token |
|---|---|
| `bg-teal-700` | `--accent-solid` |
| `hover:bg-teal-800` | `--accent-solid-hover` |
| `bg-teal-50` | `--accent-bg` |
| `text-teal-700` `text-teal-600` | `--accent-text` |
| `border-teal-200` | `--accent-line` |
| `border-teal-300` | `--accent-border` |
| `ring-teal-500` | `--ring` (= `--accent-focus`) |
| `var(--color-primary, #hex)` `var(--color-teal)` `var(--color-accent)` | `--accent-solid` (fill) / `--accent-text` (text) — drop the hex fallback |

## Status ramps

| Old | → Token |
|---|---|
| `text-red-800` `text-red-700` `text-red-600` `text-red-500` `text-red-400` | `--danger-text` |
| `bg-red-50` | `--danger-bg` |
| `border-red-100` `border-red-200` | `--danger-border` |
| `text-amber-800` `text-amber-700` `text-amber-600` `text-amber-500` `text-amber-400` | `--warn-text` |
| `bg-amber-50` | `--warn-bg` |
| `bg-amber-400` `bg-amber-500` | `--warn-solid` |
| `border-amber-100` `border-amber-200` | `--warn-border` |
| `text-emerald-700` `text-emerald-600` `text-emerald-500` `text-emerald-400` | `--ok-text` |
| `bg-emerald-50` | `--ok-bg` |
| `bg-emerald-500` | `--ok-solid` |
| `text-blue-600` `text-blue-400` | `--info-text` |
| `bg-blue-50` | `--info-bg` |

## Categorical / industry (⚠ manual — Phase 7)

These are **not** semantic status or the brand accent — they encode a category (chart series)
or an industry identity. They move to a color‑blind‑safe categorical palette `--cat-1..N`
(built in Phase 7 from an evenly‑spaced hue wheel), **not** to a status ramp.

| Old | Meaning | → |
|---|---|---|
| `ring-cyan-400` `ring-purple-400` `ring-orange-400` | industry accent chips / avatars | `--cat-*` or the industry's own generated accent |
| `text-purple-600` | chart/tag categorical | `--cat-*` |
| chart hex in `components/ui/charts.tsx`, recharts `fill`/`stroke` | series colors | `--cat-1..N` |

## Hardcoded hex (~642) — four buckets

| Bucket | Example | Action |
|---|---|---|
| **Token‑fallback duplicates** | `var(--color-primary, #0f766e)` | Drop the hex fallback; token is guaranteed set. Mechanical. |
| **`ds/tokens.ts` palette** | the `t.color.*` hex object | Rewrite to reference CSS vars (Phase 4). |
| **Industry brand hues** | `accentColor` in `lib/industry-config.ts` | **Keep** — these are *inputs* to the ramp, i.e. data, not style. |
| **One‑off decorative** | inline gradient stops, chart fills | ⚠ manual per file (Phases 4/7). |

## Keep (intentional — not migration targets)

- `lib/industry-config.ts` `accentColor` values — brand hue inputs.
- `lib/theme.ts` / `lib/platform.ts` defaults — resolution inputs.
- Anything under this `docs/` tree.
- The public quote / request pages already read `theme.primaryColor` (a resolved token value)
  — leave their prop threading; just ensure the value comes from the ramp.

## Screen priority order for Phase 6

Migrate in dependency order so shared surfaces are correct before the screens that use them:

1. `components/ui/app-shell.tsx` + `globals.css` shell classes (Phase 5)
2. `components/ds/*` primitives (Phase 4)
3. `app/dashboard` + industry dashboards + `charts.tsx`
4. `app/queue` / `queue-client`
5. CRM: `contacts-client`, `companies-client`, `deals-board-client`, `client-detail-panel`
6. `quotes-client`, `q/[token]`, quote PDF surfaces
7. `inventory-client`, `materials`
8. `settings/*`, `team-client`, `roles-client`, `billing-client`
9. Marketing: `campaigns*`, `sequences`, `templates`, `segments`
10. `research-studio-client`, reports, analytics
11. The long tail (admin, integrations, onboarding, mocks)

Each screen is independent and mechanical once `color-map.json` is frozen — Phase 6 can fan
these out in parallel, each verified by a light+dark visual diff.
