#!/usr/bin/env bash
# Runs the infra-provisioning seed validator against the live source DB,
# then proves the validator ITSELF is load-bearing: clone the DB, delete a
# seeded row from the clone, point the validator at the clone, and require RED.
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

WF_ROOT="$(cd "$HERE/../.." && pwd)"           # workflows/infra-provisioning
VALIDATOR="$WF_ROOT/source-db/validate-seed-data.sh"
CONTAINER="dtm-infra-provisioning-source-db"
REAL_DB="infra_provisioning_db"
CLONE_DB="seed_check_tmp_infra"

# --- arrange -----------------------------------------------------------------
if ! docker exec "$CONTAINER" true >/dev/null 2>&1; then
  se_skip "container $CONTAINER not running — bring up the stack first"
fi

cleanup() {
  docker exec "$CONTAINER" psql -U infra_user -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $CLONE_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- act (1): the validator against the REAL, untouched seed -----------------
real_output="$(bash "$VALIDATOR" 2>&1)"
real_rc=$?

# --- act (2): negative control — clone the DB, delete a seeded row, re-run ---
# A tx-rollback in a separate psql session would be INVISIBLE to a validator
# that opens its own connection — so this uses a real throwaway clone instead,
# and the validator is pointed at it via the SEED_CHECK_DB env var it already
# supports.
docker exec "$CONTAINER" psql -U infra_user -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $CLONE_DB" >/dev/null 2>&1 || true
docker exec "$CONTAINER" psql -U infra_user -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $CLONE_DB" >/dev/null 2>&1
clone_created=$?

if [ "$clone_created" -eq 0 ]; then
  docker exec "$CONTAINER" sh -c "pg_dump -U infra_user -d $REAL_DB | psql -U infra_user -d $CLONE_DB" >/dev/null 2>&1
  # Delete SE-04's DNS record (DNS-PROD-EU-1) from the CLONE only. Deleting it
  # via CASCADE also removes its dependent certificate, which the validator
  # doesn't separately assert on, but the DNS-record FAIL is enough proof.
  docker exec "$CONTAINER" psql -U infra_user -d "$CLONE_DB" -v ON_ERROR_STOP=1 \
    -c "DELETE FROM dbo.certificates WHERE dns_record_id='DNS-PROD-EU-1'; DELETE FROM dbo.dns_records WHERE record_id='DNS-PROD-EU-1'" >/dev/null 2>&1

  clone_output="$(SEED_CHECK_DB="$CLONE_DB" bash "$VALIDATOR" 2>&1)"
  clone_rc=$?
else
  clone_output=""
  clone_rc=1
  log_warn "could not create clone DB $CLONE_DB — negative control unproven"
fi

# --- assert (1:1 with README checkbox list) -----------------------------------
ck_eq   "validator exits 0 against the real, untouched seed" "$real_rc" "0"
ck_has  "validator reports PASS against the real seed" "$real_output" "RESULT: PASS"
ck      "clone database created for the negative control" test "$clone_created" -eq 0
ck_eq   "validator exits 1 against the clone with a deleted row (RED-proof)" "$clone_rc" "1"
ck_has  "validator names the deleted row's FAIL in its own output" "$clone_output" "FAIL: SE-04 DNS-PROD-EU-1 present"

se_summary
