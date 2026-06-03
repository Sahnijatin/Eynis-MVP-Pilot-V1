#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Installs dependencies and provisions a local Postgres so that
# `npm run lint` and `npm run test` work out of the box in a fresh container.
# Idempotent: safe to re-run on resume/clear/compact.
set -euo pipefail

# Only run in the remote (Claude Code on the web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

echo "[session-start] Installing npm dependencies..."
npm install --legacy-peer-deps

echo "[session-start] Building @eynis/shared (required by api + web)..."
npm run build -w @eynis/shared

echo "[session-start] Generating Prisma client..."
npm run db:generate -w @eynis/api

# ── Local Postgres (the API test suite hits a real database) ────────────────
PG_VERSION="16"
PG_CLUSTER="main"
DB_NAME="eynis"
DB_USER="postgres"
DB_PASS="postgres"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"

if command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "[session-start] Ensuring Postgres cluster ${PG_VERSION}/${PG_CLUSTER} is running..."
  if ! pg_lsclusters "${PG_VERSION}" "${PG_CLUSTER}" 2>/dev/null | grep -q online; then
    pg_ctlcluster "${PG_VERSION}" "${PG_CLUSTER}" start || true
  fi

  echo "[session-start] Configuring database role + database (idempotent)..."
  su postgres -c "psql -tAc \"ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';\"" || true
  if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}';\"" | grep -q 1; then
    su postgres -c "createdb ${DB_NAME}" || true
  fi

  echo "[session-start] Applying Prisma migrations..."
  DATABASE_URL="${DATABASE_URL}" npm run db:deploy -w @eynis/api || true

  # Persist DATABASE_URL for the rest of the session (tests, db:seed, dev server).
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export DATABASE_URL=\"${DATABASE_URL}\"" >> "${CLAUDE_ENV_FILE}"
  fi
else
  echo "[session-start] Postgres not available — skipping DB setup. Non-DB tests (e.g. compliance) will still run."
fi

echo "[session-start] Done."
