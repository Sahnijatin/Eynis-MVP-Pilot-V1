# Day 16 - 2026-04-16

## Goal
- Enforce production-grade data discipline: remove hardcoded metrics from module screens.
- Establish connector-first platform baseline so external hotel systems can be integrated cleanly.

## Planned Tasks
- [x] Add backend analytics endpoints for Revenue Intelligence and Staff Performance.
- [x] Add backend connector registry endpoint for integration visibility.
- [x] Wire frontend module screens to real API responses (no static demo metrics).
- [x] Extend tests to validate analytics + connector registry contracts.

## What We Implemented
- Backend (`apps/api/src/server.ts`)
  - Added `GET /analytics/revenue-intelligence`
    - aggregates offer events by type
    - computes conversion funnel and revenue totals
    - computes late-checkout revenue and left-on-table estimate from real records
  - Added `GET /analytics/staff-performance`
    - computes completion rate, avg resolution minutes, utilization
    - builds per-user leaderboard from real request history
    - computes workload-by-role and runtime alert signals
  - Added `GET /connectors/registry`
    - exposes connector catalogue with category, ingest modes, env-flag driven status
    - designed for connector-first architecture (PMS/WhatsApp/POS/payments)
  - Added policy map controls for all three new endpoints.
- Tests (`apps/api/src/server.test.ts`)
  - New test: `analytics endpoints and connector registry return real payloads`
  - API suite now validates 10 endpoints/flows.
- Frontend data layer (`apps/web/lib/data.ts`)
  - Added strongly typed fetchers:
    - `fetchRevenueAnalytics()`
    - `fetchStaffPerformance()`
    - `fetchConnectorRegistry()`
- Frontend pages
  - `apps/web/app/revenue-intelligence/page.tsx`
    - now renders live totals, top converting offers, and real funnel values
  - `apps/web/app/staff-performance/page.tsx`
    - now renders live summary, leaderboard, alerts, workload bars
  - `apps/web/app/settings/page.tsx`
    - now renders live connector registry table from backend

## What Worked
- Revenue + Staff pages now source metrics from backend APIs only.
- Connector visibility is now explicit in product UI and backend API, aligning to “bring everything via connectors.”

## Validation / Test Evidence
- `npm run test` passed (shared + api + web placeholder), including new analytics test.
- `npm run build` produced complete Next route output for updated pages.
- Lint checks on changed files returned no errors.

## Pending Items
- Replace webhook skeleton with provider adapters (Interakt/Twilio) and payload normalization contracts.
- Add connector config persistence per hotel (instead of env-only flags).
- Remove remaining scaffold-only modules or wire them to real endpoints (Guest DB, Sentiment, Automations).

## Plan for Day 17
- Implement provider adapter abstraction (`ConnectorAdapter` interface + Interakt/Twilio implementations) and webhook normalization pipeline.

