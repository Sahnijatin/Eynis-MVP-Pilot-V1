# Day 13 - 2026-04-02

## Goal
- Replace query-banner feedback with dismissible UI (or lightweight toasts).
- Start auth hardening and remove any bootstrap-only assumptions.

## Planned Tasks
- [x] Add a dismiss button for the queue `msg` banner (clears `action/result/msg` query params, keeps filters).
- [ ] Optionally add lightweight “toast” styling without extra dependencies.
- [x] Add auth hardening hook: allow `EYNIS_API_TOKEN` to bypass bootstrap `/auth/token`.
- [ ] Update engineering notes for the release checklist (envs, run steps, demo data).

## What Worked Previously
- Day 12: flash `msg` + filter-preserving redirects work.

## Validation
- [ ] Manual: confirm banner shows and can be dismissed (filters stay).
- [ ] Manual: confirm auth still works for protected routes (with and without `EYNIS_API_TOKEN`).

