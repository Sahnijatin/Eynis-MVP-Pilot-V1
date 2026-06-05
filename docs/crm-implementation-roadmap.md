# Eynis CRM — Implementation Roadmap (Sequential)

> Companion to `docs/crm-design.md`. That doc is the *what & why* (research + design).
> **This doc is the *order of execution*** — the step-by-step build sequence, broken into
> sub-phases you can ship and check off one at a time.

## Confirmed decisions (locked)

| Decision | Choice |
|---|---|
| **Currency** | **INR (₹)** as the default deal currency (editable per tenant later) |
| **Pipeline stages** | **Standard names** (Option A): Lead In → Qualified → Proposal → Negotiation → Won / Lost (renameable later) |
| **First to build** | **Increment A** (Pipeline + Deals + Forecasting) — the pilot's request |
| **Build style** | Each increment = one PR; each sub-phase = one reviewable commit |

## The big picture (build order)

```
INCREMENT A  ──────────►  INCREMENT B  ──────────►  INCREMENT C
Pipeline + Deals          Contacts hub +            Activities timeline
+ Forecasting             Companies                 + AI
(the pilot ask)           (the spine)               (the moat)

   ships first              builds on A                builds on B
```

**Golden rule:** finish and ship each increment before starting the next. A is usable on its
own; B and C add to it without reworking what came before.

---

## INCREMENT A — Pipeline + Deals + Forecasting  *(the pilot deliverable)*

**Goal:** a sales team can create deals, drag them through pipeline stages on a board, and see a
live revenue forecast in ₹.

| Sub-phase | What gets built | Depends on |
|---|---|---|
| **A1 — Database foundation** | Add `Pipeline`, `Stage`, `Deal`, `DealTransition` tables to the Prisma schema; run the migration. Currency field defaults to `"INR"`. | — |
| **A2 — Seed defaults** | Auto-create a default pipeline (the 6 standard stages) for every tenant + on new-tenant creation. Seed a few demo deals on the demo tenant so the board isn't empty. | A1 |
| **A3 — Permissions** | Add `view_crm` (read) and `manage_crm` (write) permissions; attach to roles (admin/manager/supervisor = manage, viewer = view); register routes in `policyMap`. | A1 |
| **A4 — Pipeline & Stage APIs** | Backend endpoints to read the pipeline + its stages (and edit stages later). New `core/crm/` module. | A1, A3 |
| **A5 — Deal APIs** | Create / edit / list / delete deals, plus the **"move deal to another stage"** endpoint (auto-marks Won/Lost and logs a transition). | A4 |
| **A6 — Forecast engine** | The math: open pipeline value, **weighted forecast** (value × stage probability), this-month / this-quarter buckets, win rate — exposed via `GET /deals/forecast`. | A5 |
| **A7 — Deals board UI** | New `/deals` page with a **drag-and-drop kanban board** (one column per stage); dragging a card calls the move API. Add `Deals` to the sidebar nav. | A5 |
| **A8 — Forecast strip + deal panel** | A forecast summary bar above the board (₹ totals) + a create/edit deal side panel. | A6, A7 |
| **A9 — Tests & ship** | API tests (tenant isolation, Won/Lost side-effects, forecast math), `build`/`lint`/`test` green, open PR. | A1–A8 |

**✅ Increment A is done when:** a user can create a ₹-valued deal, drag it across stages, and the
forecast number updates live — all isolated per tenant, with a default pipeline working out of the box.

---

## INCREMENT B — Contacts Hub + Companies  *(the spine)*

**Goal:** turn the existing thin contact record into a real CRM hub, so deals and campaign leads
all roll up to **one persistent person**, optionally grouped under a **company/account**.

| Sub-phase | What gets built | Depends on |
|---|---|---|
| **B1 — Extend Contact + add Company** | Add CRM fields to the existing `Contact` (email, owner, lifecycle stage, lead status, tags, source, custom fields); add a new `Company` table; migration (all additive, no data loss). | Increment A |
| **B2 — Link & backfill** | Add `contactId` to `Deal` and `CampaignLead`; backfill — create/match Contacts from existing leads by phone, and link them. Idempotent + tenant-scoped. | B1 |
| **B3 — Contact APIs** | Create / edit / list / search Contacts, and a contact-detail endpoint (with their deals). | B1 |
| **B4 — Company APIs** | Create / edit / list Companies; link contacts and deals to a company. | B1 |
| **B5 — Contact segments** | Extend the existing segment rules engine so saved segments can target Contacts (not just campaign leads). | B3 |
| **B6 — Contacts & Companies UI** | New `/contacts` list + detail page (showing their deals); `/companies` list + detail. Company nav hidden unless the tenant enables B2B/accounts. | B3, B4 |
| **B7 — Wire deals to contacts** | In the deal panel (from A8), let users attach an existing contact; show the contact on the deal and the deal on the contact. | B3, A8 |
| **B8 — Tests & ship** | Backfill tests, dedupe tests, tenant-isolation tests, PR. | B1–B7 |

**✅ Increment B is done when:** every deal and campaign lead links to one durable Contact, contacts
have a real profile page, and (optionally) companies group them — with no duplicate-person mess.

---

## INCREMENT C — Activities Timeline + AI  *(the moat)*

**Goal:** one unified timeline of every interaction per contact/deal, plus the AI features that
make Eynis's CRM smarter than a bolt-on — scoring, next-best-action, and auto-summaries.

| Sub-phase | What gets built | Depends on |
|---|---|---|
| **C1 — Activity model** | Add an `Activity` table (calls, messages, notes, tasks, meetings, stage-changes) linked to Contact/Deal; migration. | Increment B |
| **C2 — Auto-capture (projection)** | Feed existing events into the timeline: call records, WhatsApp messages, campaign sends, service requests, connector events all appear as activities automatically. | C1 |
| **C3 — Manual notes & tasks** | Let users add notes and create tasks with due dates; reuse the automation engine to send reminders/nudges. | C1 |
| **C4 — Timeline UI** | A chronological timeline component on the Contact and Deal pages. | C2, C3 |
| **C5 — Tasks view** | A "My tasks / follow-ups" screen so nothing slips through the cracks. | C3 |
| **C6 — AI scoring** | `scoreContact()` — a 0–100 lead/deal score with reasons, recomputed as new activity lands (reuses the existing AI layer). | C2 |
| **C7 — AI next-best-action + summary** | Per contact/deal: suggest the next step + draft the message; auto-summarize the whole timeline into a one-paragraph "relationship brief." | C2, C6 |
| **C8 — Reporting** | Pipeline velocity, win rate over time, source attribution dashboards. | C2 |
| **C9 — Tests & ship** | Coverage for projection, scoring, reporting; PR. | C1–C8 |

**✅ Increment C is done when:** opening a contact or deal shows a full cross-channel history, an AI
score, a suggested next action, and a one-line relationship summary — and managers get win-rate /
velocity reports.

---

## At-a-glance progress tracker

```
INCREMENT A — Pipeline + Deals + Forecasting   ✅ Done
  A1 DB foundation          ✅
  A2 Seed defaults          ✅
  A3 Permissions            ✅
  A4 Pipeline/Stage APIs    ✅
  A5 Deal APIs              ✅
  A6 Forecast engine        ✅
  A7 Deals board UI         ✅
  A8 Forecast strip + panel ✅
  A9 Tests & ship           ✅  (265/265 API tests pass, lint clean)

INCREMENT B — Contacts Hub + Companies         ⬜ Not started
  B1 Extend Contact + Company   ⬜
  B2 Link & backfill            ⬜
  B3 Contact APIs               ⬜
  B4 Company APIs               ⬜
  B5 Contact segments           ⬜
  B6 Contacts & Companies UI    ⬜
  B7 Wire deals to contacts     ⬜
  B8 Tests & ship               ⬜

INCREMENT C — Activities Timeline + AI         ⬜ Not started
  C1 Activity model         ⬜
  C2 Auto-capture           ⬜
  C3 Notes & tasks          ⬜
  C4 Timeline UI            ⬜
  C5 Tasks view            ⬜
  C6 AI scoring            ⬜
  C7 AI next-best-action   ⬜
  C8 Reporting             ⬜
  C9 Tests & ship          ⬜
```

**Where we are today:** Increment A (Pipeline + Deals + Forecasting) is **built, tested, and
shipped**. **Next step = Increment B (Contacts hub + Companies), starting at B1.**
