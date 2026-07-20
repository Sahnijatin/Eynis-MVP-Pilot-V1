# Token contract

Every value below is a CSS custom property defined on `:root`, redefined for dark under
`@media (prefers-color-scheme: dark)` **and** `:root[data-theme="dark"]`, and pinned for
light under `:root[data-theme="light"]` (so the in‑app toggle overrides the OS in both
directions). Components read **only** these tokens.

Value tables show the **default** (platform brand hue = indigo `#5B5BD6`) under the
**Fintech Trust** personality. Accent steps are **generated at runtime** from the tenant hue
(Phase 1), so their hex is illustrative, not fixed. Neutrals, status, elevation, radius and
type are personality constants and are fixed per theme.

> Contrast targets, verified in CI (Phase 1/8): body text ≥ **4.5:1**, large text & non‑text
> UI ≥ **3:1**, on the surface it sits on, in **both** themes, for **any** tenant hue.

---

## 1. Surfaces

| Token | Role | Light | Dark |
|---|---|---|---|
| `--bg` | App canvas (warm paper) | `#FBFAF8` | `#0E0F14` |
| `--surface` | Card / panel | `#FFFFFF` | `#16181F` |
| `--surface-2` | Elevated: popover, menu, modal (dark gets **lighter**, not darker) | `#FFFFFF` | `#1C1F27` |
| `--surface-inset` | Wells, table zebra, hover fills | `#F5F3F0` | `#101218` |
| `--sidebar` | App rail (personality: near‑surface, not hard navy) | `#FFFFFF` | `#121319` |

## 2. Lines

| Token | Role | Light | Dark |
|---|---|---|---|
| `--border` | Hairline dividers, card edges | `#ECE9E4` | `#262A33` |
| `--border-strong` | Inputs, emphasized separation | `#DAD5CD` | `#333844` |
| `--ring` | Keyboard focus ring | `var(--accent-focus)` | `var(--accent-focus)` |

## 3. Text (ink‑navy family — the Fintech signature)

| Token | Role | Light | Dark |
|---|---|---|---|
| `--text` | Headings, primary body | `#1A1D29` | `#ECEEF4` |
| `--text-muted` | Secondary text, labels | `#545869` | `#A0A6B4` |
| `--text-subtle` | Captions, meta, timestamps | `#7E8291` | `#757C8B` |
| `--text-faint` | Placeholder, disabled | `#A9ACB8` | `#565C6B` |
| `--text-on-accent` | Text on `--accent-solid` | `#FFFFFF` | `#FFFFFF` |

## 4. Accent — the generated 12‑step ramp (08)

Generated in OKLCH from the tenant brand hue at **fixed lightness targets** (Radix model), so
the *role* of each step is stable across every hue. Hex shown for the default indigo.

| Step | Role | Light (illustrative) | Dark (illustrative) |
|---|---|---|---|
| `--accent-1` | App background subtle | `#FDFCFE` | `#111018` |
| `--accent-2` | App background | `#F8F7FE` | `#161528` |
| `--accent-3` | Component background | `#EFEDFB` | `#20213F` |
| `--accent-4` | Component hover | `#E6E3F8` | `#282A50` |
| `--accent-5` | Component active / selected | `#DCD8F3` | `#31335F` |
| `--accent-6` | Border subtle | `#CFC9ED` | `#3B3E6F` |
| `--accent-7` | Border | `#BDB4E4` | `#494C84` |
| `--accent-8` | Border strong / **focus ring** | `#A395D8` | `#5D5FA6` |
| `--accent-9` | **Solid** (primary buttons, active nav) | `#5B5BD6` | `#6E6ADE` |
| `--accent-10` | Solid hover | `#5151C4` | `#7E7BE8` |
| `--accent-11` | Low‑contrast **text** (links, accented labels) | `#4A45B5` | `#B7B3FF` |
| `--accent-12` | High‑contrast text | `#25224E` | `#E2E0FF` |

**Aliases** (what most components use, so step numbers stay an implementation detail):

| Alias | = step | Use |
|---|---|---|
| `--accent-bg` | 3 | tinted backgrounds (e.g. active nav wash, badge bg) |
| `--accent-bg-hover` | 4 | hover on tinted surfaces |
| `--accent-line` | 6 | subtle accent borders |
| `--accent-border` | 7 | accent borders, input focus edge |
| `--accent-focus` | 8 | focus ring (`--ring`) |
| `--accent-solid` | 9 | filled buttons, active nav, primary CTA |
| `--accent-solid-hover` | 10 | filled button hover |
| `--accent-text` | 11 | links, accented text on `--surface`/`--bg` |

> The accent hex above is illustrative only — `lib/color/ramp.ts` (Phase 1) computes every
> step from the live tenant hue. Never hand‑copy these; they are outputs, not inputs.

## 5. Status ramps (semantic, separate from the accent)

Each status is a 3‑tone set: `-bg` (tint), `-border`, `-text` (AA on `-bg` and on `--surface`),
plus an optional `-solid` for filled chips. Status is **never** the accent, and must always be
paired with an icon/shape so it survives color‑blindness (see `migration-map.md` §Categorical).

### Success `--ok-*` (emerald)
| | Light | Dark |
|---|---|---|
| `--ok-bg` | `#E7F4EE` | `#122820` |
| `--ok-border` | `#BFE3D2` | `#1E4938` |
| `--ok-text` | `#0E7C66` | `#4ADE9B` |
| `--ok-solid` | `#12936F` | `#12936F` |

### Warning `--warn-*` (amber)
| | Light | Dark |
|---|---|---|
| `--warn-bg` | `#FBF3E2` | `#2A2113` |
| `--warn-border` | `#F0DCB0` | `#4A3B1C` |
| `--warn-text` | `#8A5A0B` | `#E0A83B` |
| `--warn-solid` | `#D9922B` | `#D9922B` |

### Danger `--danger-*` (red)
| | Light | Dark |
|---|---|---|
| `--danger-bg` | `#FCECEC` | `#2A1616` |
| `--danger-border` | `#F6C9C9` | `#4A2626` |
| `--danger-text` | `#C0362C` | `#F0757A` |
| `--danger-solid` | `#DC4438` | `#DC4438` |

### Info `--info-*` (blue — distinct from a bluish brand hue)
| | Light | Dark |
|---|---|---|
| `--info-bg` | `#ECEFFC` | `#171B2E` |
| `--info-border` | `#C9D3F6` | `#2A3357` |
| `--info-text` | `#3B4F9E` | `#8CA0FF` |

## 5b. Categorical `--cat-1..8` (series / identity — Phase 7)

For **chart series and category identity only** — never status, never the brand
accent. A colour-blind-safe 8-hue set (Tailwind keys `cat.1..8` → `bg-cat-1`,
`text-cat-1`, …). Assign in **fixed order, never cycled**; a 9th series folds into
"Other"/facets, never a generated hue. Always pair with a legend/label/shape so
hue never carries meaning alone. Validated against the chart surfaces
(`--surface` #FFFFFF / #16181F) — worst adjacent CVD ΔE 9.1 light / 8.4 dark;
three light slots sit <3:1 (relief rule → legend/label required).

| Token | Hue | Light | Dark |
|---|---|---|---|
| `--cat-1` | blue | `#2a78d6` | `#3987e5` |
| `--cat-2` | green | `#008300` | `#008300` |
| `--cat-3` | magenta | `#e87ba4` | `#d55181` |
| `--cat-4` | yellow | `#eda100` | `#c98500` |
| `--cat-5` | aqua | `#1baf7a` | `#199e70` |
| `--cat-6` | orange | `#eb6834` | `#d95926` |
| `--cat-7` | violet | `#4a3aa7` | `#9085e9` |
| `--cat-8` | red | `#e34948` | `#e66767` |

**Chip tints** `--cat-1..8-bg` (light + dark) pair with the solid hue as text for
pills/badges. Only slots **1 / 2 / 7 / 8** clear ~3:1 text-on-tint in **both**
themes (validated) — use those for `{color: var(--cat-N), background: var(--cat-N-bg)}`
chips; 3/4/5/6 are for solid marks (dots, series fills), not text-on-tint.

**Chart chrome** aliases theme tokens so charts flip with no dark override:
`--chart-grid` (=`--border`), `--chart-axis` (=`--text-subtle`),
`--chart-tooltip-bg` (=`--surface`), `--chart-tooltip-border` (=`--border`),
`--chart-compare` (=`--text-faint`, muted prior-period line).

## 6. Elevation (Fintech flat + optional Soft Depth glass)

Ambient shadows carry a faint accent tint (~6% alpha) so depth reads warm, not gray.

| Token | Light | Dark |
|---|---|---|
| `--shadow-1` | `0 1px 2px rgba(26,29,41,.05)` | `0 1px 2px rgba(0,0,0,.4)` |
| `--shadow-2` | `0 1px 2px rgba(26,29,41,.04), 0 4px 12px -4px rgba(26,29,41,.10)` | `0 2px 10px -4px rgba(0,0,0,.6)` |
| `--shadow-3` | `0 2px 4px rgba(26,29,41,.05), 0 12px 28px -10px rgba(26,29,41,.14)` | `0 8px 26px -12px rgba(0,0,0,.7)` |
| `--shadow-4` | `0 4px 8px rgba(26,29,41,.06), 0 24px 48px -16px rgba(26,29,41,.18)` | `0 14px 40px -16px rgba(0,0,0,.75)` |
| `--shadow-5` | `0 8px 16px rgba(26,29,41,.08), 0 40px 80px -24px rgba(26,29,41,.24)` | `0 24px 60px -20px rgba(0,0,0,.8)` |

Glass surfaces (Soft Depth option, modals/popovers only): `background: color-mix(in srgb,
var(--surface) 72%, transparent)` + `backdrop-filter: blur(10px)`.

## 7. Radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | `6px` | inputs, chips, small controls |
| `--radius-md` | `8px` | buttons, cards (Fintech default) |
| `--radius-lg` | `12px` | panels, modals |
| `--radius-xl` | `16px` | glass / feature surfaces |
| `--radius-full` | `9999px` | pills, avatars |

## 8. Type (finalized in Phase 3 via `next/font`, self‑hosted)

| Token | Family | Use |
|---|---|---|
| `--font-sans` | Inter (body) | UI, body copy |
| `--font-display` | a refined display/grotesque (e.g. Inter Display) | headings, big metrics |
| `--font-mono` | `ui-monospace, "JetBrains Mono", Menlo, Consolas` | data, IDs, timers |

**Numerals:** every metric, money and timer column sets `font-variant-numeric: tabular-nums`
(utility class `.tnum`). Money aligns on the decimal.

Modular type scale (1.25): `12 / 14 / 16 / 20 / 25 / 31 / 39 px`, tokens `--fs-1..7`.

## 9. Spacing (existing 4px grid stays)

`--space-1..8` = `4 8 12 16 24 32 48 64`. Layout uses flex/grid `gap`, never per‑element
margins that collapse.

---

## Theme‑block skeleton (Phase 2 will write this into `globals.css`)

```css
:root {
  --bg:#FBFAF8; --surface:#FFFFFF; /* …all light values… */
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#0E0F14; --surface:#16181F; /* …all dark values… */ }
}
:root[data-theme="light"] { --bg:#FBFAF8; /* …pin light… */ }
:root[data-theme="dark"]  { --bg:#0E0F14; /* …pin dark… */ }
```

The generated `--accent-1..12` for both themes are injected per request from the resolved
tenant hue (extends the existing runtime injection in `components/ui/app-shell.tsx:282`).
