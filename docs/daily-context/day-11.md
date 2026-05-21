# Day 11 - 2026-04-01

## Goal
- Loading and empty states, submit pending feedback for forms, preserve queue filters after row actions, light visual baseline.

## Planned Tasks
- [x] Route-level loading UI for dashboard and queue.
- [x] Empty states when queue or trend series has no data.
- [x] Disable / “Working…” on form submit (native POST/GET navigations).
- [x] Preserve filter query string on status/assign redirect (safe whitelist).
- [x] Minimal global CSS tokens and skeleton animation.

## What We Implemented
- `apps/web/app/globals.css` — CSS variables, link styles, `.skeleton-bar` pulse.
- `apps/web/app/layout.tsx` — import globals, system font stack, `var(--color-bg)`.
- `apps/web/app/queue/loading.tsx`, `apps/web/app/dashboard/loading.tsx` — skeleton placeholders.
- `apps/web/lib/redirect-queue.ts` — `buildActionRedirectUrl` (allowed paths `/queue`, `/dashboard`; allowed query keys for filters only).
- `apps/web/lib/queue-filters.ts` — `filtersToSearchString` for hidden `returnSearch` on row forms.
- API routes `status` / `assign` — read `returnSearch`, redirect via `buildActionRedirectUrl`.
- `apps/web/components/ui/pending-form.tsx` — client `PendingForm` + `PendingSubmitButton`; pending via `React.Context` (no render-prop children: RSC cannot pass functions into Client Components).
- `apps/web/app/queue/page.tsx` — filter form and row forms use `PendingForm`; hidden `returnSearch`; empty queue message.
- `apps/web/app/dashboard/page.tsx` — empty trend copy when series is empty.

## What Worked
- Filter state survives status/assign round-trip without open-redirect or arbitrary query injection.
- Pending buttons give immediate feedback before navigation completes.

## What Did Not Work
- `useFormStatus` was not suitable for string `action` forms; replaced with explicit pending state on `onSubmit`.

## Fixes / Decisions Taken
- Whitelist redirect path and query keys server-side.
- Toast system deferred; query banner remains for action result.

## Validation / Test Evidence
- Command: `npm run build; npm run test` (from repo root).

## Pending Items
- Table primitives, toast notifications, Tailwind/shadcn polish.
- Optional background SLA refresh job; production auth replacing bootstrap token.

## Plan for Day 12
- Tighten table layout and action column UX; optional error detail on failed assign/status.
