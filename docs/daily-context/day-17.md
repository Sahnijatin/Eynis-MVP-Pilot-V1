# Day 17 - 2026-04-02

## Goal
- Introduce provider adapter abstraction for WhatsApp webhooks and normalize inbound payloads before request creation.

## Planned Tasks
- [x] Add a reusable normalization layer for Interakt, Twilio, and generic webhook payloads.
- [x] Route webhook ingestion through normalized provider output in API.
- [x] Add automated tests validating provider normalization behavior.

## What We Implemented
- Added `apps/api/src/core/connectors/whatsapp.ts` with:
  - `NormalizedWhatsappInbound` contract.
  - Provider-specific normalizers for `interakt`, `twilio`, and `generic`.
  - Auto-detection fallback when provider is not explicitly passed.
- Updated `POST /integrations/whatsapp/webhook` in `apps/api/src/server.ts` to:
  - Normalize inbound payloads through the new adapter layer.
  - Reject un-normalizable payloads with explicit 400 error.
  - Persist normalized provider in audit metadata.
  - Return provider in API response payload.
- Added tests in `apps/api/src/server.test.ts`:
  - `whatsapp webhook normalization supports twilio payload`
  - `whatsapp webhook normalization supports interakt payload`

## What Worked
- Existing webhook flow reused seamlessly after normalization.
- Category/priority inference continues to work with normalized message data.
- Multi-provider tests passed alongside the full existing API suite.

## What Did Not Work
- Provider-specific signature validation is not implemented yet (current endpoint still uses optional shared secret gate).

## Fixes / Decisions Taken
- Standardized all providers into one inbound schema before business logic to keep downstream request creation provider-agnostic.
- Kept fallback generic normalization to preserve backward compatibility for current webhook clients.

## Validation / Test Evidence
- Command: `npm run test -w @eynis/api`
- Result: 12/12 tests passed, including Twilio and Interakt normalization coverage.
- Command: `npm run build -w @eynis/api`
- Result: TypeScript build passed.

## Pending Items
- Add provider-level signature verification (Twilio signature, Interakt verification strategy).
- Persist connector credentials/config per hotel (not env-only).
- Implement outbound provider adapter methods (send ack/template message via provider APIs).

## Plan for Day 18
- Build connector configuration persistence model per hotel and expose secure CRUD endpoints for connector setup.
