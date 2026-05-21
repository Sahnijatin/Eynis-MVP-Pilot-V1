# Day 14 - 2026-04-02

## Goal
- Re-align with product spec by shipping two missing Phase-1 foundations:
  - Guest QR intake (public request path)
  - WhatsApp adapter skeleton (webhook -> request + acknowledgement)

## Planned Tasks
- [x] Add public API endpoint for QR intake (`POST /public/requests`).
- [x] Add WhatsApp webhook skeleton endpoint (`POST /integrations/whatsapp/webhook`).
- [x] Add minimal web QR form page for pilot/demo (`/request`).
- [x] Add automated tests for both new backend flows.

## What We Implemented
- API (`apps/api/src/server.ts`)
  - Added `POST /public/requests`:
    - validates `hotelId`, `guestName`, `guestPhone`, `summary`
    - upserts guest by `hotelId + phone`
    - creates queue item (`source=qr`) and audit log
  - Added `POST /integrations/whatsapp/webhook` skeleton:
    - optional secret check via `WHATSAPP_WEBHOOK_SECRET` header
    - maps inbound message to basic category/priority
    - upserts guest, creates queue item (`source=whatsapp`), writes audit, returns ack message
  - Added helper functions for phone normalization, guest upsert, and request creation.
- API tests (`apps/api/src/server.test.ts`)
  - `public QR request intake creates service request`
  - `whatsapp webhook skeleton creates request and returns ack`
- Web (`apps/web`)
  - Added route handler `app/api/public/request/route.ts` to proxy form submit to API.
  - Added guest form page `app/request/page.tsx` for QR deployment.
  - Added top-nav link to `/request` in `app/layout.tsx`.

## What Worked
- End-to-end QR path now exists with no auth requirement for guest-side submission.
- WhatsApp webhook skeleton creates operational queue records immediately and returns a deterministic acknowledgement payload.

## What Did Not Work
- No blockers in this slice.

## Validation / Test Evidence
- `npm run build` passed all workspaces.
- `npm run test` passed all workspaces.
- API tests now pass `9/9` including the 2 newly added cases.

## Pending Items (Spec Alignment)
- Replace webhook skeleton with real provider adapters (Interakt/Twilio contracts and verification).
- Add guest acknowledgement outbound send through adapter (currently returned as payload + audit).
- Add automation engine trigger wiring for Day-1 flows (check-in brief, sentiment, night audit, etc.).

## Plan for Day 15
- WhatsApp provider adapter abstraction v1 + payload normalization + verification strategy.
- Start event/trigger registry for automations (first: request acknowledgement + SLA escalation hooks).

