#!/usr/bin/env bash
# Asserts a database bootstrapped via the REAL bootstrap path
# (scripts/init-clean-database.sh) is information_schema-identical to a
# database built by `migration:run` against an empty database — the two
# ways of getting a clean dtm schema must never drift apart (Phase 2a, D1).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq/ck_has/ck_file_has/ck_absent (pipefail-safe, mutate counters — never call in $()),
# se_skip (exit 77 sentinel), se_summary, se_start_bg/se_stop_bg (setsid+pgid — hermetic servers),
# se_wait_http (poll-for-ready, no fixed sleeps), free_port.
# NOTE: this SE is FLAT under setpoint-evals/ (no suite subdir, matching
# SE-01..SE-13), so it's 2 levels above repo root, not the usual 3 —
# se-lib.sh is sourced with an adjusted relative path and ROOT is computed
# directly instead of via se_root() (which assumes suite nesting).
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# Load DTM_DB_* from .env (same vars docker-compose/typeorm.config.ts read) so
# the host-side `migration:run` in Path B below can authenticate — mirrors
# scripts/init-clean-database.sh's own env loading.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -vE '^\s*#' "$ROOT/.env" | grep -vE '^\s*$')
  set +a
fi

DB_CONTAINER="${COMPOSE_PROJECT_NAME:-dtm}-db"
VERIFY_DB="dtm_se14_verify"
PGUSER="${DTM_DB_USER:-dtm_user}"
PGDB="${DTM_DB_NAME:-dtm}"
PGPASS="${DTM_DB_PASSWORD:-dtm}"
PGPORT_HOST="${DTM_DB_PORT_HOST:-5448}"

# --- arrange -----------------------------------------------------------------
docker exec "$DB_CONTAINER" true >/dev/null 2>&1 || se_skip "$DB_CONTAINER is not running"

DUMP_SQL="
SELECT 'TABLE|' || table_name
FROM information_schema.tables
WHERE table_schema='public' AND table_name <> 'migrations'
UNION ALL
SELECT 'COLUMN|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || COALESCE(column_default,'') || '|' || COALESCE(character_maximum_length::text,'')
FROM information_schema.columns
WHERE table_schema='public' AND table_name <> 'migrations'
UNION ALL
SELECT 'INDEX|' || indexname || '|' || tablename || '|' || indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename <> 'migrations'
UNION ALL
SELECT 'CONSTRAINT|' || tc.table_name || '|' || tc.constraint_name || '|' || tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema='public' AND tc.table_name <> 'migrations'
  AND tc.constraint_type <> 'CHECK'
UNION ALL
SELECT 'ENUM|' || t.typname || '|' || e.enumlabel
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY 1;
"
# CHECK constraints are excluded: Postgres auto-names unnamed NOT NULL check
# constraints from internal (schema_oid, table_oid, attnum)-derived numbers
# (e.g. \"2200_16945_3_not_null\"), which are NON-DETERMINISTIC across any two
# independently-created databases even from the byte-identical migration —
# comparing them would produce permanent false-RED noise. NOT NULL-ness is
# already captured (deterministically) via information_schema.columns above.

# dtm_jobs_exists — cheap liveness probe for the isolation guard below (uses
# to_regclass, which returns NULL — not an error — for a missing relation).
dtm_jobs_exists() {
  local out
  out="$(docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -tAc "SELECT to_regclass('public.dtm_jobs');" 2>/dev/null)"
  [ "$out" = "dtm_jobs" ]
}

tmp="$(mktemp -d)"
cleanup() {
  docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS $VERIFY_DB;" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

# --- act -----------------------------------------------------------------
# Path A: the REAL bootstrap path a developer/CI actually runs.
bash "$ROOT/scripts/init-clean-database.sh" >"$tmp/bootstrap.log" 2>&1
BOOTSTRAP_RC=$?
# log_warn, NOT log_fail: this is forensic narration for a verdict already carried by
# `ck "bootstrap path (init-clean-database.sh) ran cleanly" test "$BOOTSTRAP_RC" -eq 0` below.
# Since server-config #755 log_fail increments _SE_FAIL, a log_fail here would DOUBLE-COUNT the
# same defect. log_warn is the established "prints, increments no counter" idiom.
[ "$BOOTSTRAP_RC" -eq 0 ] || { log_warn "bootstrap path exited $BOOTSTRAP_RC — see $tmp/bootstrap.log"; tail -n 40 "$tmp/bootstrap.log"; }

# --- ISOLATION GUARD ---------------------------------------------------------
# A destructive SE (this one drops and rebuilds the ENTIRE schema) must never
# leave the shared DB destroyed for every SE/workflow-suite that runs after
# it — a bootstrap failure here previously cascaded into SE-15/17/19 and all
# three workflow suites reporting unrelated "relation dtm_jobs does not exist"
# / "no jobId returned" failures (Fix 4c, 2026-07-17). If dtm_jobs is missing
# after Path A, replay the (now-idempotent, see SE-24) bootstrap ONCE more to
# restore a known-good schema before this script does anything else. SE-14
# itself still reports FAIL below for the original bootstrap failure — this
# only protects DOWNSTREAM SEs, it does not paper over this SE's own verdict.
if [ "$BOOTSTRAP_RC" -ne 0 ] && ! dtm_jobs_exists; then
  log_warn "dtm_jobs missing after a failed bootstrap — restoring schema so downstream SEs aren't cascade-failed by this one"
  bash "$ROOT/scripts/init-clean-database.sh" >"$tmp/restore.log" 2>&1
  RESTORE_RC=$?
  if [ "$RESTORE_RC" -eq 0 ] && dtm_jobs_exists; then
    log_warn "restore succeeded — dtm_jobs exists again; downstream SEs can proceed"
  else
    # log_warn, NOT log_fail (server-config #755): this block is only reachable when
    # BOOTSTRAP_RC != 0, which the `ck "bootstrap path ... ran cleanly"` below ALWAYS fails on,
    # so this can never be the sole signal — and the restore outcome itself is separately
    # asserted by `ck "dtm_jobs exists on exit (isolation ...)" dtm_jobs_exists`. Its two
    # sibling narrations in this same block are already log_warn.
    log_warn "RESTORE FAILED (exit $RESTORE_RC) — dtm_jobs still missing, downstream SEs WILL cascade-fail — see $tmp/restore.log"
    tail -n 40 "$tmp/restore.log"
  fi
fi

docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -tA -c "$DUMP_SQL" >"$tmp/bootstrap.schema" 2>"$tmp/bootstrap.err"

# Path B: fresh empty database, migrated by the SAME migration:run TypeORM
# invocation the bootstrap path itself uses under the hood — but on an
# independent database, so this is a genuine second execution, not a
# tautology.
{
  docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS $VERIFY_DB;"
  docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE $VERIFY_DB OWNER $PGUSER;"
} >"$tmp/createdb.log" 2>&1

(
  cd "$ROOT/services/orchestrator" || exit 1
  export DTM_DB_HOST=localhost
  export DTM_DB_PORT_HOST="$PGPORT_HOST"
  unset DTM_DB_PORT
  export DTM_DB_USER="$PGUSER"
  export DTM_DB_PASSWORD="$PGPASS"
  export DTM_DB_NAME="$VERIFY_DB"
  npx typeorm-ts-node-commonjs migration:run -d dataSource.ts
) >"$tmp/migrate.log" 2>&1
MIGRATE_RC=$?
# log_warn, NOT log_fail (server-config #755): the verdict is carried by
# `ck "fresh migration:run against empty DB ran cleanly" test "$MIGRATE_RC" -eq 0` below.
[ "$MIGRATE_RC" -eq 0 ] || { log_warn "fresh migration:run exited $MIGRATE_RC — see $tmp/migrate.log"; tail -n 40 "$tmp/migrate.log"; }
docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d "$VERIFY_DB" -tA -c "$DUMP_SQL" >"$tmp/migrate.schema" 2>"$tmp/migrate.err"

diff -u "$tmp/bootstrap.schema" "$tmp/migrate.schema" >"$tmp/schema.diff" || true

# --- assert (1:1 with the README checkbox list) ------------------------------
ck   "bootstrap path (init-clean-database.sh) ran cleanly"          test "$BOOTSTRAP_RC" -eq 0
ck   "fresh migration:run against empty DB ran cleanly"             test "$MIGRATE_RC" -eq 0
ck   "bootstrap-path schema dump is non-empty (sanity)"             test -s "$tmp/bootstrap.schema"
ck   "fresh-migrate schema dump is non-empty (sanity)"               test -s "$tmp/migrate.schema"
ck   "information_schema diff (bootstrap vs fresh migrate) is EMPTY" test ! -s "$tmp/schema.diff"
# Isolation guard (always checked, not just on the restore path): a bootstrap
# failure must NEVER leave dtm_jobs missing on exit — this is what protects
# every SE/workflow-suite that runs after SE-14 in the same run-all.sh pass.
ck   "dtm_jobs exists on exit (isolation — a bootstrap failure never cascades downstream)" dtm_jobs_exists

if [ -s "$tmp/schema.diff" ]; then
  echo "── schema drift detected ──────────────────────────────────────"
  cat "$tmp/schema.diff"
  echo "────────────────────────────────────────────────────────────────"
fi

se_summary
