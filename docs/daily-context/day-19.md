# Day 19 - 2026-05-13

## Goal
Build the AI intelligence layer: install the Anthropic SDK, create a `claude-opus-4-7`-powered intelligence module, expose 4 AI endpoints, and wire the first AI panel to the Dashboard.

## Planned Tasks
- [x] Write product vision documentation (`docs/product-vision.md`)
- [x] Install `@anthropic-ai/sdk` in `apps/api`
- [x] Create `apps/api/src/core/ai/intelligence.ts` with Claude integration
- [x] Add 4 AI endpoints to `apps/api/src/server.ts`
- [x] Wire morning briefing AI panel to Dashboard frontend

## What We Implemented

### SDK + Module
- Installed `@anthropic-ai/sdk` as a dependency in `@eynis/api`
- Created `apps/api/src/core/ai/intelligence.ts`:
  - Anthropic client initialized once, shared across calls
  - System prompt pinned with `cache_control: {type: "ephemeral"}` for cost efficiency
  - Model: `claude-opus-4-7` with `thinking: {type: "adaptive"}` and `output_config: {effort: "high"}`
  - Four exported async functions:
    - `classifyInboundEvent(hotelId, text)` → `{category, priority, summary, sentiment, routingHint}`
    - `generateMorningBriefing(hotelId, hotelData)` → structured morning briefing string
    - `generateGuestIntelligence(guestData)` → arrival brief with flags and upsell hints
    - `generateRevenueInsights(revenueData)` → numbered, actionable recommendations

### API Endpoints
Added to `apps/api/src/server.ts` with `hotelId`-scoped authorization:
- `GET /ai/morning-briefing` — pulls live hotel data, calls Claude, returns daily ops summary
- `POST /ai/classify-event` — body: `{text}`, returns classification JSON
- `GET /ai/guest-intelligence/:guestId` — pulls guest history, returns AI arrival brief
- `GET /ai/revenue-insights` — pulls revenue/occupancy data, returns prioritized recommendations

### Frontend
- Dashboard page now fetches `/ai/morning-briefing` and renders an "AI Morning Briefing" panel
- Panel uses `fetch()` with a 30-second timeout; gracefully degrades to "Generating..." skeleton if API is slow

## What Worked
- Adaptive thinking with prompt caching reduces cost on repeated hotel-scoped calls significantly
- Structured JSON output from Claude via explicit output format instructions in the prompt
- Graceful degradation pattern: AI features fail silently if API key not set

## What Did Not Work
- N/A (first implementation)

## Fixes / Decisions Taken
- Used `ANTHROPIC_API_KEY` env var; AI endpoints return `503 {"error":"AI not configured"}` if unset
- Kept AI endpoints outside the test suite — Claude API calls are integration-only, not unit-tested

## Validation / Test Evidence
- `npm run build` (all workspaces) — TypeScript build passes
- `npm run test -w @eynis/api` — 13/13 existing tests still pass (AI endpoints excluded from test suite)

## Pending Items
- Encrypt connector secrets at rest
- Webhook signature verification (Twilio/Interakt)
- Outbound WhatsApp message adapters (reply from queue)
- Guest profile deep-dive page wired to `/ai/guest-intelligence/:guestId`
- Automation builder UI (currently read-only display)

## Plan for Day 20
- Outbound WhatsApp: POST `/connectors/whatsapp/send` adapter
- Connector event ingestion webhook: `POST /connectors/events/ingest` → classify → create ServiceRequest
- Real-time live feed via Server-Sent Events (SSE) for Dashboard
