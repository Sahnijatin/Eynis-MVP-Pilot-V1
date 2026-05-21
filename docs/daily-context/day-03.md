# Day 03 - 2026-04-01

## Goal
- Move service-request and audit flows from in-memory to database-backed APIs with tenant isolation.

## Planned Tasks
- [x] Implement DB-backed create/list service request APIs.
- [x] Persist audit entries in DB for key event paths.
- [x] Add tenant isolation tests.
- [x] Validate full build and test pipeline.

## What We Implemented
- Upgraded `apps/api/src/server.ts`:
  - Added async request handling with central error guard.
  - Added JSON body parser for POST endpoints.
  - Added DB-backed hotel access check per tenant context.
  - Added `POST /service-requests`:
    - supports `guestId` OR (`guestName` + `guestPhone`)
    - creates guest when needed
    - creates service request with status `open`
    - writes audit log entry in DB
  - Added `GET /service-requests` with hotel scoping and latest-first ordering.
  - Migrated `/audit` from in-memory to Prisma-backed reads.
  - Persisted audit write for `/events/service-request-created`.
- Expanded API tests in `apps/api/src/server.test.ts`:
  - creates per-test hotel records
  - validates tenant context behavior
  - validates event -> audit persistence
  - validates tenant-scoped service request listing (hotel A cannot see hotel B data)
- Added architecture policy file:
  - `docs/engineering-principles.md`

## What Worked
- Tenant-scoped DB writes and reads work correctly.
- API tests reliably validate core Day 3 scenarios.
- Full monorepo build and tests stayed green.

## What Did Not Work
- Initial TypeScript compile errors from `unknown` payload fields after JSON parsing.

## Fixes / Decisions Taken
- Introduced safe string coercion helper and strict request validation path.
- Kept event bus in-memory for now, but made critical audit trail DB-persistent.
- Enforced hotel existence check for protected endpoints to reduce spoofed header risk.

## Validation / Test Evidence
- Command: `npm run build; npm run test`
- Result:
  - Build passed all workspaces.
  - Tests passed: shared (1), api (4), web placeholder.

## Pending Items
- Replace header-only identity with signed auth.
- Add role-based authorization matrix per endpoint.
- Add pagination/filtering for service request lists.
- Add DB-backed offer event write/list endpoints.

## Plan for Day 04
- Introduce auth middleware skeleton (token parsing + user lookup).
- Add role guards for owner/front desk/ops actions.
- Add service request status transition endpoint (`accept`, `resolve`, `escalate`) with audit events.
