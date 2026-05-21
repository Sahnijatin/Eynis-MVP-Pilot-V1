# Day 18 - 2026-04-02

## Goal
- Persist connector setup per hotel and expose secure APIs for connector configuration management.

## Planned Tasks
- [x] Add a persistent connector configuration model in Prisma.
- [x] Implement authenticated connector config management endpoints.
- [x] Wire connector registry status to hotel-level persisted connector settings.
- [x] Add automated tests validating config CRUD + registry reflection.

## What We Implemented
- Added `ConnectorConfig` model in `apps/api/prisma/schema.prisma` with:
  - per-hotel unique key (`@@unique([hotelId, connectorKey])`)
  - `enabled` flag
  - `configJson` payload storage
  - timestamps and hotel relation
- Updated `apps/api/src/server.ts`:
  - Added policy entries for connector config endpoints.
  - Added path parser for `PUT/DELETE /connectors/configs/:key`.
  - Added secure endpoints:
    - `GET /connectors/configs`
    - `PUT /connectors/configs/:key`
    - `DELETE /connectors/configs/:key`
  - Added secret masking for sensitive config fields (`token`, `secret`, `password`, `*key`).
  - Updated `GET /connectors/registry` to merge persisted hotel config over env flags and return source (`hotel_config` or `env`).
- Added test in `apps/api/src/server.test.ts`:
  - `connector configs are persisted per hotel and reflected in registry`

## What Worked
- Connector setup is now tenant-scoped and survives restarts via database persistence.
- Registry endpoint now reflects real configured status at hotel level.
- Full API suite passed with new config flow.

## What Did Not Work
- Prisma engine file lock (`EPERM`) initially blocked `prisma generate`; resolved by stopping conflicting Node dev/test processes and rerunning generation.

## Fixes / Decisions Taken
- Kept backward compatibility by preserving env-flag fallback when no hotel-level config exists.
- Returned masked connector config in API responses to avoid leaking secrets through dashboard/API consumers.

## Validation / Test Evidence
- Command: `npx prisma generate --schema prisma/schema.prisma`
- Result: Prisma client generated successfully after lock resolution.
- Command: `npx prisma db push --schema prisma/schema.prisma`
- Result: Database synced with `ConnectorConfig` table.
- Command: `npm run test` (in `apps/api`)
- Result: 13/13 tests passed.
- Command: `npm run build` (in `apps/api`)
- Result: TypeScript build passed.

## Pending Items
- Encrypt connector secrets at rest instead of plain JSON storage.
- Add provider-specific signature validation and credentials test endpoint.
- Wire frontend settings module to new connector config CRUD APIs.

## Plan for Day 19
- Implement AI intelligence ingestion layer on top of normalized connector events (classification + routing rules).
