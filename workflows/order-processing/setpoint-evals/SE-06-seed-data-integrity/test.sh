#!/usr/bin/env bash
# Runs the order-processing seed validator against the live source DB, then
# proves the validator ITSELF is load-bearing: clone the DB, delete a seeded
# row from the clone, point the validator at the clone, and require RED.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq/ck_has/ck_file_has/ck_absent (pipefail-safe, mutate counters — never call in $()),
# se_skip (exit 77 sentinel), se_summary, se_start_bg/se_stop_bg (setsid+pgid — hermetic servers),
# se_wait_http (poll-for-ready, no fixed sleeps), free_port.
# NOTE: this SE lives 4 dirs below repo root (workflows/<name>/setpoint-evals/SE-NN/),
# one deeper than the standard <repo>/setpoint-evals/<suite>/SE-NN/ layout the scaffold
# assumes — hence 4 "../" here (not the scaffold's default 3), and se_root() (which
# assumes the same 3-deep layout) is NOT used; WF_ROOT is computed explicitly instead.
. "$HERE/../../../../scripts/se-lib.sh"

WF_ROOT="$(cd "$HERE/../.." && pwd)"           # workflows/order-processing
VALIDATOR="$WF_ROOT/source-db/validate-seed-data.sh"
# dtm-db is the copy the Lambda workers actually read (see validator header);
# clone/drop need CREATEDB, which only the container superuser (dtm_user) has there.
CONTAINER="dtm-db"
ADMIN_USER="dtm_user"
REAL_DB="order_processing_db"
CLONE_DB="seed_check_tmp_op"

# --- arrange -----------------------------------------------------------------
if ! docker exec "$CONTAINER" true >/dev/null 2>&1; then
  se_skip "container $CONTAINER not running — bring up the stack first"
fi

cleanup() {
  docker exec "$CONTAINER" psql -U "$ADMIN_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $CLONE_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- act (1): the validator against the REAL, untouched seed -----------------
real_output="$(SEED_CHECK_CONTAINER="$CONTAINER" bash "$VALIDATOR" 2>&1)"
real_rc=$?

# --- act (2): negative control — clone the DB, delete a seeded row, re-run ---
# A tx-rollback in a separate psql session would be INVISIBLE to a validator
# that opens its own connection (see setpoint-eval-conventions.md D6-style
# vacuous-pass guards) — so this uses a real throwaway clone instead, and the
# validator is pointed at it via the SEED_CHECK_DB env var it already supports.
docker exec "$CONTAINER" psql -U "$ADMIN_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $CLONE_DB" >/dev/null 2>&1 || true
docker exec "$CONTAINER" psql -U "$ADMIN_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $CLONE_DB OWNER order_user" >/dev/null 2>&1
clone_created=$?

if [ "$clone_created" -eq 0 ]; then
  docker exec "$CONTAINER" sh -c "pg_dump -U order_user -d $REAL_DB | psql -U order_user -d $CLONE_DB" >/dev/null 2>&1
  # Delete SE-03's dedicated customer (Donald Knuth, customer_id=6) from the
  # CLONE only — FK-dependents first (order_items/payments/shipments → orders
  # → customer), else the final DELETE is an FK violation and the row SURVIVES,
  # turning the negative control into a vacuous pass (exactly what happened on
  # 2026-07-16: ON_ERROR_STOP failed the DELETE, 2>/dev/null swallowed it, and
  # the "RED-proof" assertion caught the validator still passing).
  docker exec -i "$CONTAINER" psql -U order_user -d "$CLONE_DB" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null 2>&1
DELETE FROM ecommerce.order_items WHERE order_id=6;
DELETE FROM ecommerce.payments    WHERE order_id=6;
DELETE FROM ecommerce.shipments   WHERE order_id=6;
DELETE FROM ecommerce.orders      WHERE order_id=6;
DELETE FROM ecommerce.customers   WHERE customer_id=6;
SQL

  clone_output="$(SEED_CHECK_CONTAINER="$CONTAINER" SEED_CHECK_DB="$CLONE_DB" bash "$VALIDATOR" 2>&1)"
  clone_rc=$?
else
  clone_output=""
  clone_rc=1
  log_warn "could not create clone DB $CLONE_DB — negative control skipped its own bookkeeping, treated as unproven"
fi

# --- assert (1:1 with README checkbox list) -----------------------------------
ck_eq   "validator exits 0 against the real, untouched seed" "$real_rc" "0"
ck_has  "validator reports PASS against the real seed" "$real_output" "RESULT: PASS"
ck      "clone database created for the negative control" test "$clone_created" -eq 0
ck_eq   "validator exits 1 against the clone with a deleted row (RED-proof)" "$clone_rc" "1"
ck_has  "validator names the deleted row's FAIL in its own output" "$clone_output" "FAIL: SE-03 customer 6 (Donald Knuth) present"

se_summary
