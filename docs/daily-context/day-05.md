# Day 05 - 2026-04-01

## Goal
- Harden auth with signed tokens, add policy-based authorization, and implement request assignment + transition history.

## Planned Tasks
- [x] Replace header-identity auth with JWT bearer auth.
- [x] Add endpoint authorization policy map.
- [x] Add service request assignment endpoint.
- [x] Add transition history persistence and read endpoint.
- [x] Validate migration/build/tests.

## What We Implemented
- Added token auth module:
  - `apps/api/src/core/auth.ts`
  - uses `jose` (`HS256`) for signing and verification
  - bearer token parsing and claim validation
- Added auth token endpoint:
  - `POST /auth/token` (development bootstrap login)
  - validates active user in DB and issues signed token
- Migrated protected routes to bearer token auth:
  - `/context`
  - `/events/service-request-created`
  - `/service-requests` (create/list)
  - `/service-requests/:id/status`
  - `/audit`
- Added authorization policy map in API with role-by-endpoint checks.
- Added assignment and history capabilities:
  - Prisma schema updates:
    - `ServiceRequest.assignedToUserId`
    - `ServiceRequestTransition` model
  - API endpoints:
    - `PATCH /service-requests/:id/assign`
    - `GET /service-requests/:id/transitions`
  - status changes now persist transition entries.
- Updated tests to use token-based auth flow via `/auth/token`.
- Added test coverage for assignment + transition history.

## What Worked
- Token issuance and verification works reliably for test users.
- Authorization checks enforce role boundaries across endpoints.
- Assignment and transition history persisted and retrievable.
- Build, migrations, and tests all pass.

## What Did Not Work
- Prisma schema initially missed reverse relation from `Hotel` to transitions.

## Fixes / Decisions Taken
- Added `Hotel.transitions` relation and regenerated migration.
- Kept `/auth/token` as a controlled bootstrap mechanism for now; production SSO/JWT issuer integration comes later.
- Maintained strict tenant scoping on all request and transition operations.

## Validation / Test Evidence
- Command: `npm run db:generate -w @eynis/api; npm run db:migrate -w @eynis/api`
- Result: success; migration applied and client generated.
- Command: `npm run build; npm run test`
- Result:
  - Build passed all workspaces.
  - Tests passed: shared (1), api (6), web placeholder.

## Pending Items
- Replace `/auth/token` bootstrap with production auth provider flow.
- Add token rotation/blacklist strategy for emergency revocation.
- Add pagination/filter controls for transitions endpoint.

## Plan for Day 06
- Introduce request queue filters and assignment views for staff roles.
- Add SLA deadline fields + breach marker pipeline.
- Add first dashboard endpoint aggregations for open vs resolved and SLA health.
