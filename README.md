# Eynis Platform

[![CI](https://github.com/Sahnijatin/Eynis-MVP-Pilot-V1/actions/workflows/ci.yml/badge.svg)](https://github.com/Sahnijatin/Eynis-MVP-Pilot-V1/actions/workflows/ci.yml)

Monorepo foundation for the Eynis intelligence platform.

## Workspaces
- `apps/api`: backend API
- `apps/web`: management and staff web app
- `packages/shared`: shared domain types and utilities

## Quick Start
1. `npm install --legacy-peer-deps`
2. `npm run build`
3. `npm run test`
4. `npm run dev -w @eynis/api`

## Deployment
The web app deploys to Vercel on merge to `main`. On the Hobby plan, Vercel only
builds commits authored by the account owner, so the owner should perform the
final merge to `main` for the production deploy to trigger.

