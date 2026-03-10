#!/usr/bin/env bash
set -euo pipefail

DB_URL=${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/infoverify?sslmode=disable}
OUT_FILE=${1:-internal/dal/postgres/schema.sql}

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found. Please install PostgreSQL client tools." >&2
  exit 1
fi

pg_dump --schema-only --no-owner --no-privileges "$DB_URL" > "$OUT_FILE"

echo "Schema written to $OUT_FILE"
