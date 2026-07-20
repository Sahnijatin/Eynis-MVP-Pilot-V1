# PMS connectors — eZee & Hotelogix (#169)

Real property-management-system (PMS) connectors, replacing the simulate-only
integration. A PMS pushes reservation events (check-in / check-out) to Eynis by
**webhook**; a per-provider adapter normalizes the vendor payload into one
canonical event that the shared ingest path writes to the DB (Contact + Stay + a
live SSE broadcast).

## Architecture (`apps/api/src/core/connectors/pms/`)

- **`types.ts`** — the `CanonicalPmsEvent` shape, the `PmsAdapter` contract, and
  defensive, case-insensitive field helpers (`pickString` / `pickDate` /
  `classifyEvent`).
- **`adapters.ts`** — `genericAdapter` (the legacy `{ event, guest, reservation }`
  shape, kept for back-compat), `ezeeAdapter`, `hotelogixAdapter`, and
  `selectPmsAdapter(providerOrKey)` (resolves by `?provider=` or connector key
  `pms_*`; unknown → generic).
- **`ingest.ts`** — `ingestPmsEvent(tenantId, canonical)`: upserts the contact,
  bumps visit count + creates a `Stay` on check-in, broadcasts the SSE event.

Adding another PMS/POS = one new adapter object + one entry in the `ADAPTERS`
registry; nothing else changes.

## Webhook

```
POST /connectors/pms/webhook?provider=<ezee|hotelogix>&tenantId=<tenantId>
x-webhook-secret: <PMS_WEBHOOK_SECRET>   # required in production
```

- **Tenant** is resolved from `?tenantId=` (or a `tenantId`/`hotelId` field in the
  body). Real PMS payloads carry the *vendor's* property id, not ours, so the
  tenant is identified by the URL you configure the PMS to POST to.
- **Provider** comes from `?provider=`, the `x-pms-provider` header, or a
  `provider`/`connectorKey` body field. Absent → the generic shape.
- **Auth**: the shared `PMS_WEBHOOK_SECRET` gate (`x-webhook-secret`) — fails
  closed in production, open in dev.

Response: `201 { event: "checkin", stayId, guestId, provider }`,
`200 { event: "checkout", … }`, or `400` for an unrecognised payload.

## Field mapping

The eZee / Hotelogix adapters map those vendors' **published reservation-API field
shapes** (defensively — multiple key spellings, case-insensitive), e.g. eZee's
`FirstName`/`LastName`/`Mobile`/`RoomNo`/`ArrivalDate`/`DepartureDate`/`Status`,
Hotelogix's `guestName`/`mobile`/`roomNo`/`checkInDate`/`checkOutDate`/`eventType`.

> **Validate before a production pilot.** These mappings follow the documented API
> formats but have **not** been verified against a live eZee/Hotelogix account (that
> needs vendor credentials this repo doesn't hold). Confirm the exact field names +
> a sample payload from the tenant's account, then adjust the adapter's key lists if
> needed — the tests in `pms.test.ts` show the expected shapes.

## Not in scope (documented follow-up)

- **API-pull** (fetching room/rate inventory + historical reservations via the
  vendor REST API using the tenant's `apiKey`) — the connectors advertise `api` in
  `ingestModes` but only the `webhook` push path is implemented today. Building the
  pull side needs live credentials and per-vendor auth flows.
- POS connectors (Petpooja, etc.) follow the same adapter pattern when prioritised.
