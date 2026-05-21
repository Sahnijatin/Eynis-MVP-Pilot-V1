# Day 12 - 2026-04-01

## Goal
- Polish queue table layout and separate action columns from read-only data.
- Surface API and validation errors on the queue after redirects (short flash message).

## Planned Tasks
- [x] Sticky table header + scroll container for long queues.
- [x] Column widths, action-column backgrounds, clearer labels (“Status change” vs “Assign”).
- [x] Pass sanitized `msg` query param on error redirects; parse API `{ error }` JSON.
- [x] Client-side validation copy for empty status / empty assignee.

## What We Implemented
- `apps/web/lib/flash-message.ts` — `sanitizeFlashMessage`, `extractApiErrorMessage` for PATCH error bodies.
- `apps/web/lib/redirect-queue.ts` — optional `flashMessage` on `buildActionRedirectUrl` (sets `msg` only when `result=error`).
- `apps/web/app/api/requests/[id]/status/route.ts` and `assign/route.ts` — friendly validation messages; API error text on failure.
- `apps/web/app/queue/page.tsx` — reads `msg`, shows under banner; table wrapper with `maxHeight` + sticky `<thead>`; fixed layout and tinted action cells.

## What Worked
- Error strings from the API (e.g. transition rules, 404) show up without exposing raw stack traces.
- `msg` is not part of filter `returnSearch`, so it does not persist across unrelated navigations.

## What Did Not Work
- No blockers.

## Fixes / Decisions Taken
- Cap and strip control characters on flash text; do not whitelist `msg` in `returnSearch` merge (server-only append).

## Validation / Test Evidence
- Command: `npm run build` (root or `-w @eynis/web`).
- Manual: queue filters persist after status/assign; API failure shows a flash `msg` under the banner.

## Pending Items
- Toasts or dismissible alerts; Tailwind/shadcn pass.
- Production auth; `npm audit` hardening.

## Plan for Day 13
- Optional: commit/push pilot; start auth or notification UX.
