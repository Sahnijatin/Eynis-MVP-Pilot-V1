# Eynis Day 1 Execution Checklist

## Goal
Establish a production-minded foundation so feature delivery starts on Day 2 without rework.

## Scope
- Monorepo scaffold (`apps/web`, `apps/api`, `packages/shared`)
- Shared domain types for core entities
- API health endpoint and test harness
- Web placeholder app consuming shared package
- Baseline TypeScript and lint/test scripts

## Definition of Done
- `npm install` succeeds at root
- `npm run build` succeeds across all workspaces
- `npm run test` succeeds across all workspaces
- API starts and responds on `/health`
- Web app renders basic shell

## Risks Tracked
- Package manager drift across machines
- Over-scaffolding before first user flow
- Missing environment strategy for WhatsApp providers

## Next Slice (Day 2)
- Data model and migrations
- Auth roles and tenant model
- Event/audit primitives
