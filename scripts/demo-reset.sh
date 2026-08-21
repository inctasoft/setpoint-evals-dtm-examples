#!/usr/bin/env bash
# demo-reset.sh — TRUNCATE dtm_jobs (cascades to dtm_steps) so a demo-video
# recording session starts against an empty job table.
#
# ux-storyboards.md §4 DX NOTE item 3 ("a demo:reset script target that
# truncates jobs/steps between takes"). NOT load-bearing for the ?demo=1 fix
# (apps/monitor/src/app.tsx's own pageLoadTime filter already scopes the job
# LIST to jobs created after the page loaded, and the full-screen console dock
# is always job-scoped) — this is a belt-and-suspenders convenience for a
# human/agent who wants a genuinely clean `All Jobs (0)` table before a take,
# e.g. for a screenshot or a manual walkthrough, not something
# generate-demo-media.sh depends on for correctness.
#
# Opt-in and DESTRUCTIVE ONLY to dtm_jobs/dtm_steps (never touches schema,
# other tables, Kafka, or SQS) — requires an explicit --yes, never runs by
# default from generate-demo-media.sh.
#
# Usage:
#   DTM_DB_PASSWORD=<...> bash scripts/demo-reset.sh --yes
#   pnpm demo:reset -- --yes   (see package.json)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

DB_HOST="${DTM_DB_HOST_OVERRIDE:-localhost}"
DB_PORT="${DTM_DB_PORT_HOST:-5448}"
DB_USER="${DTM_DB_USER:-dtm_user}"
DB_NAME="${DTM_DB_NAME:-dtm}"
DB_PASSWORD="${DTM_DB_PASSWORD:-}"

if [ -z "$DB_PASSWORD" ] && [ -f "$ROOT/.env" ]; then
  DB_PASSWORD="$(grep -E '^DTM_DB_PASSWORD=' "$ROOT/.env" | tail -1 | cut -d= -f2-)"
fi
DB_PASSWORD="${DB_PASSWORD:-migration_pass}"

if [ "${1:-}" != "--yes" ]; then
  echo "demo-reset.sh: refuses to run without --yes (this TRUNCATEs dtm_jobs/dtm_steps)." >&2
  echo "  DTM_DB_PASSWORD=... bash scripts/demo-reset.sh --yes" >&2
  exit 1
fi

echo "==> Truncating dtm_jobs (cascades to dtm_steps) on ${DB_HOST}:${DB_PORT}/${DB_NAME}"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c "TRUNCATE TABLE dtm_jobs RESTART IDENTITY CASCADE;"

echo "==> Done. All Jobs should now read (0) in the monitor."
