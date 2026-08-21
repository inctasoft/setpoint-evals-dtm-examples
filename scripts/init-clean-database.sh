#!/bin/bash
# Initialize Clean Database
#
# Wipes the dtm-db schema and rebuilds it by running the REAL TypeORM
# migration chain (packages/database/src/migrations/) — the single schema
# source of truth (Phase 2a, decision D1). There is no longer any
# hand-written CREATE TABLE SQL here: this script is a fast, LOCAL way to
# invoke the exact same migrations the `init-typeorm` Docker service runs
# (see docker-compose.yml + services/orchestrator/Dockerfile.db-init), just
# without paying the cost of an image build/copy on every reset. Same
# migration files, same TypeORM engine, same DataSource (services/orchestrator
# dataSource.ts, which re-exports @dtm/database's built config) — only the
# execution environment (host vs container) differs. One schema-producing
# code path, applied two ways.
#
# Use this after `./scripts/local-env.sh clean` (or any full DB wipe) to
# restore a clean, fully-migrated schema.
#
# Prerequisites: dtm-db is running and reachable on the host (the default
# `./scripts/local-env.sh start --standalone` published port). This script
# always rebuilds `@dtm/database` (fast — `tsc` on ~5 files, ~2s) before
# running migrations: `services/orchestrator/dataSource.ts` resolves the
# migration list from @dtm/database's COMPILED dist/, so a stale dist would
# otherwise let this script silently apply an outdated migration set while
# still reporting success — exactly the kind of drift D1 exists to close.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

DB_CONTAINER="${COMPOSE_PROJECT_NAME:-dtm}-db"

# Load DTM_DB_* from .env (same vars docker-compose / typeorm.config.ts read),
# then override host/port for a HOST-side connection to dtm-db's PUBLISHED
# port — the container's own env always resolves DTM_DB_HOST=dtm-db:5432
# (Docker-internal), which isn't reachable from outside the network.
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source <(grep -vE '^\s*#' "$ENV_FILE" | grep -vE '^\s*$')
  set +a
fi

export DTM_DB_HOST=localhost
export DTM_DB_PORT_HOST="${DTM_DB_PORT_HOST:-5448}"
unset DTM_DB_PORT
export DTM_DB_USER="${DTM_DB_USER:-dtm_user}"
export DTM_DB_PASSWORD="${DTM_DB_PASSWORD:-dtm}"
export DTM_DB_NAME="${DTM_DB_NAME:-dtm}"

if ! docker exec "$DB_CONTAINER" true >/dev/null 2>&1; then
  echo "❌ $DB_CONTAINER is not running. Start it first:" >&2
  echo "   ./scripts/local-env.sh start --standalone" >&2
  exit 1
fi

echo "🗑️  Dropping schema '$DTM_DB_NAME' on $DB_CONTAINER and recreating empty..."

docker exec "$DB_CONTAINER" psql -U "$DTM_DB_USER" -d "$DTM_DB_NAME" -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO $DTM_DB_USER; GRANT ALL ON SCHEMA public TO public;" \
  >/dev/null

echo "✅ Schema reset complete"
echo ""

echo "📦 Building @dtm/database (ensures dist/migrations reflects current source)..."
( cd "$PROJECT_ROOT" && pnpm --filter @dtm/database run build )
echo ""

echo "📦 Applying migrations (single schema source of truth: packages/database/src/migrations/)..."
echo ""

( cd "$PROJECT_ROOT/services/orchestrator" && npx typeorm-ts-node-commonjs migration:run -d dataSource.ts )

echo ""
echo "✅ Clean database created successfully!"
echo ""
echo "Tables:"
docker exec "$DB_CONTAINER" psql -U "$DTM_DB_USER" -d "$DTM_DB_NAME" -c "\dt"
echo ""
echo "Migration History:"
docker exec "$DB_CONTAINER" psql -U "$DTM_DB_USER" -d "$DTM_DB_NAME" -c "SELECT timestamp, name FROM migrations;"
