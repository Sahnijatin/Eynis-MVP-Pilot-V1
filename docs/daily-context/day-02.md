# Day 02 - 2026-04-01

## Goal
- Establish initial data model + tenant-aware API context + event/audit primitives.

## Planned Tasks
- [x] Add database schema and migration flow.
- [x] Add seed workflow for pilot hotel bootstrap.
- [x] Add request context guard using tenant and role headers.
- [x] Add event and audit primitives with API exposure.
- [x] Validate with build and tests.

## What We Implemented
- Prisma setup in `apps/api`:
  - `prisma/schema.prisma` with core models:
    - `Hotel`, `User`, `Guest`, `Stay`, `ServiceRequest`, `OfferEvent`, `AutomationRule`, `AuditLog`
  - scripts added:
    - `db:generate`
    - `db:migrate`
    - `db:seed`
  - local env example added (`apps/api/.env.example`)
- Seed bootstrap:
  - `prisma/seed.ts` creates one pilot hotel + owner user.
- Tenant/role context:
  - `src/core/request-context.ts`
  - validates `x-hotel-id` and `x-user-role`.
- Event and audit primitives:
  - `src/events/event-bus.ts` (in-memory publish/subscribe)
  - `src/events/audit-log.ts` (in-memory per-hotel audit store)
- API routes added:
  - `GET /context` (validated tenant/role context)
  - `POST /events/service-request-created` (publishes event + appends audit)
  - `GET /audit` (lists hotel-scoped audit entries)

## What Worked
- Prisma generate/migrate/seed ran successfully after schema fix.
- Header-based context guard works.
- Event publish + audit append flow works.
- Full monorepo build/test remains green.

## What Did Not Work
- Prisma schema initially failed due to missing reverse relation on `Guest` for `ServiceRequest`.
- PowerShell command chaining with `&&` failed (environment does not support it).

## Fixes / Decisions Taken
- Added `serviceRequests` relation to `Guest` model.
- Switched shell chaining to `;` for PowerShell compatibility.
- Kept audit/event storage in-memory for now to move fast; DB-backed audit logging will come in Day 3/4.

## Validation / Test Evidence
- Command: `npm run db:generate -w @eynis/api; npm run db:migrate -w @eynis/api; npm run db:seed -w @eynis/api`
- Result: success; migration created and DB seeded.
- Command: `npm run build; npm run test`
- Result: build passed all workspaces, tests passed (`shared`: 1, `api`: 3, `web`: placeholder).

## Pending Items
- Persist audit logs/events to database.
- Introduce auth identity model beyond header-only context.
- Add first service request write/read DB endpoints.

## Plan for Day 03
- Implement database-backed repositories for:
  - `service_requests`
  - `audit_logs`
  - `offer_events` (initial skeleton)
- Add API endpoints for creating/listing service requests with tenant scoping.
- Add tests for tenant isolation behavior.
