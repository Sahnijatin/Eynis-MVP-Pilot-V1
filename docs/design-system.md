# Eynis Design System (E-13)

The standard for building **consistent, white-label, low-complexity** UI across the
web app. This is the reference every E-13 slice (and every new feature) follows.

> Decision (E-13): we **extend the existing in-house design system** in
> `apps/web/components/ds/` rather than adopt shadcn wholesale — `ds/` is already
> wired to the white-label theme tokens, so it themes per tenant for free. We may
> selectively borrow a shadcn primitive only where `ds/` lacks one (e.g. a real
> data grid). Don't introduce a second, parallel component vocabulary.

---

## 1. Principles

1. **More capability, less complexity.** Prefer progressive disclosure (show the
   common path; tuck advanced options behind "Advanced"/expanders) over dense
   walls of controls.
2. **One component vocabulary.** Use `ds/` primitives (or the documented CSS
   classes) — never hand-roll a one-off button/card/modal/table style.
3. **White-label by default.** Brand color comes from CSS variables, never a
   hardcoded hex. A tenant's accent must flow through automatically.
4. **Industry-neutral copy.** No "guest"/"hotel"/"room" in shared UI — use
   tenant/customer/contact/request and the industry terminology helper.
5. **Never raw.** Every surface has a friendly **empty**, **loading**, and
   **error** state — never a blank screen or an unstyled dump.
6. **Honest states.** Show real zeros/empties; don't fabricate placeholder data.

---

## 2. Tokens (single source of truth)

Defined in `apps/web/components/ds/tokens.ts`, kept in lockstep with the CSS
variables in `app/globals.css`. **Always** consume tokens (or the CSS vars) —
never re-hardcode these values.

### Color
| Token | Value | Use |
|---|---|---|
| `color.bg` | `#f4f6fa` | app background |
| `color.surface` | `#ffffff` | cards, inputs, modals |
| `color.surfaceMuted` | `#f1f5f9` | hovers, fills, neutral badges |
| `color.border` | `#e6eaf0` | default borders |
| `color.borderStrong` | `#cbd5e1` | input borders |
| `color.text` | `#0f172a` | primary text |
| `color.textMuted` | `#64748b` | secondary text |
| `color.textFaint` | `#94a3b8` | hints, placeholders |
| `color.accent` | `var(--color-accent, #0f766e)` | **brand accent (white-label)** |
| `color.danger` / `success` / `warning` | — | status |

### Brand color — white-label rule
The app shell publishes the resolved tenant theme on `:root`:
`--color-primary`, `--color-accent`, `--color-industry` (all = the tenant's
resolved color), plus `--color-sidebar` / `--font-brand` on the white-label tier.

- **Canonical accent var: `var(--color-primary, #0f766e)`** for primary buttons,
  active states, highlights. `ds/` tokens use `--color-accent` (equivalent); both
  resolve to the tenant color. **The `#0f766e` is only ever a fallback** for SSR /
  pre-hydration — never use the bare hex as a brand color.
- ✅ `style={{ background: "var(--color-primary, #0f766e)" }}`
- ❌ `style={{ background: "#0f766e" }}` (off-brand for rebranded tenants)

### Scale
- **Radius:** `sm 6` · `md 8` · `lg 12` · `pill 999`
- **Shadow:** `sm` (cards) · `md` (popovers) · `lg` (modals/toasts)
- **Type:** `xs 12` · `sm 13` · `base 14` · `lg 16` · `xl 20` · `xxl 26`
- **Spacing:** 4px rhythm (Tailwind `gap-2/3/4`, `p-4`, `mb-5`); cards pad `18px`.

---

## 3. Component catalog (`components/ds`)

Import from `../../components/ds`. Props below are the supported API.

| Component | Use | Key props |
|---|---|---|
| `Button` | actions | `variant: primary\|secondary\|ghost\|danger`, `size: sm\|md` |
| `LinkButton` | anchor styled as a button (hrefs/downloads) | same as Button |
| `Card` / `CardTitle` | content container + heading | `style` |
| `PageHeader` | page title + subtitle + actions row | `title`, `subtitle?`, `actions?` |
| `Field` / `Label` | labelled form row with hint | `label?`, `hint?` |
| `Input` / `Select` / `Textarea` | form controls (token-styled) | native attrs |
| `Badge` | status pill | `tone: neutral\|success\|warning\|danger\|accent` |
| `Modal` | dialog (overlay, close, footer) | `title`, `onClose`, `footer?`, `width?` |
| `EmptyState` | empty/zero state | `title`, `description?`, `action?`, `icon?` |
| `Spinner` | inline loading | `size?` |
| `ToastProvider` / `useToast` | transient feedback | `push(text, "success"\|"error"\|"info")` |

Established CSS classes (in `globals.css`) are also part of the vocabulary and may
be used instead of inline styles: `card`, `card-title`, `kpi-grid`, `kpi-label`,
`kpi-value`, `page-header`, `page-title`, `page-subtitle`, `progress-track`,
`progress-fill`, `badge`, `data-table`, `table-wrap`. Pick one approach per
surface — don't mix a `ds/` `Card` with a raw `.card` in the same block.

---

## 4. Empty / loading / error states (required on every surface)

- **Route-level loading:** `app/loading.tsx` streams a branded spinner while a
  server component fetches. Don't block render long enough to show a blank shell.
- **Route-level error:** `app/error.tsx` (per subtree) + `app/global-error.tsx`
  (root layout). Branded, reassuring ("your data is safe"), with **Try again** +
  **Back to dashboard**. `global-error` must use a static color — it renders its
  own `<html>` before the theme vars exist.
- **Empty (no data):** use `EmptyState` (or a `card` block with a short message +
  a primary action). Always say *why* it's empty and *what to do next*.
- **Inline fetch failure:** data loaders should **degrade to a safe empty shape**
  (see `fetchSentiment` / `fetchRevenueAnalytics`) so a page renders its empty
  state instead of throwing into the error boundary.

Pattern:
```tsx
if (!data.ok || data.items.length === 0) {
  return <EmptyState title="No reports yet"
    description="Build a report over your data to see it here."
    action={<LinkButton href="/reports/new" variant="primary">New report</LinkButton>} />;
}
```

---

## 5. The UX bar (per-module acceptance, E-13)

A module/page passes the bar when:
- [ ] Uses `ds/` primitives or documented classes — no one-off button/card/modal/table styles.
- [ ] Brand color via `var(--color-primary)` — no hardcoded accent hex.
- [ ] Friendly empty, loading, and error states — never blank or raw.
- [ ] Industry-neutral copy.
- [ ] Responsive (usable down to mobile width) with visible focus states on interactive elements.

---

## 6. Rollout (E-13 slices)

1. **E-13a** — this doc + state-file consistency. *(here)*
2. **E-13c** — apply empty/loading/error states across remaining pages.
3. **E-13b** — migrate one-off tables/modals/forms onto `ds/` primitives.
4. **E-13d** — density/progressive-disclosure on the densest pages.
5. **E-13e** — responsiveness + accessibility pass.
