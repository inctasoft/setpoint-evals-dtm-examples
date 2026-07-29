#!/usr/bin/env bash
# LEADER-1: two concurrent manual triggers of the SAME maintenance task must
# produce exactly ONE execution of its body — the loser is skipped by the
# Postgres advisory lock (BaseMaintenanceTask.execute() -> AdvisoryLockService.
# runExclusive), not a duplicate run.
#
# Before the fix, AdvisoryLockService was only consulted inside each task's
# @Cron scheduledRun() handler — the manual-trigger API
# (POST /maintenance/tasks/:taskName/execute) called task.execute() directly,
# bypassing the lock entirely, so two concurrent manual fires both ran
# doExecute() fully unguarded.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq/ck_has (pipefail-safe, mutate counters — never call in $()),
# se_skip (exit 77 sentinel), se_summary.
# NOTE: this SE is FLAT under setpoint-evals/ (SE-01..SE-15 convention), so
# se-lib.sh is 2 levels up, matching SE-14's own path comment.
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# Order-processing's helper chain gives us ORCHESTRATOR_HOST / API_VERSION /
# preflight checks (it internally sources the generic setpoint-evals/shared/
# helpers.sh — safe to source from any SE regardless of workflow).
# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

DB_CONTAINER="${COMPOSE_PROJECT_NAME:-dtm}-db"
PGUSER="${DTM_DB_USER:-dtm_user}"
PGDB="${DTM_DB_NAME:-dtm}"
STUCK_STEPS=15 # enough sequential DB round-trips inside doExecute() to widen
               # the concurrency window past network/scheduling jitter — see
               # README "Why 15 seeded steps".

log_info "SE-15: LEADER-1 advisory-lock leader election (concurrent manual triggers)"

# --- preflight ---------------------------------------------------------------
docker exec "$DB_CONTAINER" true >/dev/null 2>&1 || se_skip "$DB_CONTAINER is not running"
# Retry-poll (loaded hosts boot the orchestrator slowly after recreate-heavy SEs)
_i=0; until curl -sf -o /dev/null -m 3 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" 2>/dev/null; do
  _i=$((_i + 1)); [ "$_i" -ge 90 ] && se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"; sleep 2
done

# --- arrange: seed STUCK_STEPS synthetic WAITING_FOR_ACK steps ---------------
# Each on its own synthetic job (workflow_name/type mirror a real
# order-processing SubmitCustomer step) so the maintenance task's normal
# find-then-conditionally-update-then-continueJob loop does real, sequential
# per-row work — the winner's doExecute() must stay "in flight" long enough
# for the loser's near-simultaneous request to observe the lock held.
log_info "Seeding ${STUCK_STEPS} synthetic WAITING_FOR_ACK steps (own synthetic jobs)..."
SEED_OUT=$(docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -t -c "
WITH new_jobs AS (
  INSERT INTO dtm_jobs (workflow_name, type, status, payload, submitted_at)
  SELECT 'order-processing', 'quick-order', 'processing', '{\"se\":\"SE-15\"}'::jsonb, NOW()
  FROM generate_series(1, ${STUCK_STEPS})
  RETURNING id
)
INSERT INTO dtm_steps (job_id, step_value, status, kafka_published_at, started_at)
SELECT id, 'SubmitCustomer', 'waiting_for_ack', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour'
FROM new_jobs
RETURNING job_id;
" 2>&1)
SEEDED_COUNT=$(echo "$SEED_OUT" | grep -cE '[0-9a-f]{8}-[0-9a-f]{4}' || true)

ck "seeded exactly ${STUCK_STEPS} synthetic WAITING_FOR_ACK steps" \
  test "$SEEDED_COUNT" -eq "$STUCK_STEPS"

if [ "$SEEDED_COUNT" -ne "$STUCK_STEPS" ]; then
  log_fail "seeding failed — dumping psql output for diagnosis:"
  echo "$SEED_OUT"
  se_summary
fi

# --- act: fire TWO manual triggers as close to simultaneously as possible ---
log_info "Firing two concurrent manual triggers of 'stuck-acknowledgement'..."
RESP1="$(mktemp)"
RESP2="$(mktemp)"
TRIGGER_URL="${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/stuck-acknowledgement/execute"

curl -s -w '\nHTTP_CODE:%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"ackTimeoutMinutes": 0.001}' "$TRIGGER_URL" >"$RESP1" 2>&1 &
PID1=$!
curl -s -w '\nHTTP_CODE:%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"ackTimeoutMinutes": 0.001}' "$TRIGGER_URL" >"$RESP2" 2>&1 &
PID2=$!

wait "$PID1"
wait "$PID2"

CODE1=$(grep 'HTTP_CODE:' "$RESP1" | cut -d: -f2)
CODE2=$(grep 'HTTP_CODE:' "$RESP2" | cut -d: -f2)
BODY1=$(sed '/HTTP_CODE:/d' "$RESP1")
BODY2=$(sed '/HTTP_CODE:/d' "$RESP2")
rm -f "$RESP1" "$RESP2"

log_info "Response 1: HTTP $CODE1 — $(echo "$BODY1" | jq -c '{success,message,metrics}' 2>/dev/null)"
log_info "Response 2: HTTP $CODE2 — $(echo "$BODY2" | jq -c '{success,message,metrics}' 2>/dev/null)"

# --- assert --------------------------------------------------------------
ck_eq "request 1 returned HTTP 200" "$CODE1" "200"
ck_eq "request 2 returned HTTP 200" "$CODE2" "200"

MSG1=$(echo "$BODY1" | jq -r '.message // ""')
MSG2=$(echo "$BODY2" | jq -r '.message // ""')

SKIP_NEEDLE="leader lock held"
SKIPPED_COUNT=0
echo "$MSG1" | grep -qF "$SKIP_NEEDLE" && SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
echo "$MSG2" | grep -qF "$SKIP_NEEDLE" && SKIPPED_COUNT=$((SKIPPED_COUNT + 1))

# THE headline assertion: exactly one concurrent manual fire executed the
# task body; the other was skipped by the advisory lock. Pre-fix, this is
# 0 (both ran for real — see README RED transcript). A double-lock bug
# (both skip, e.g. lock never released) would show 2 — also wrong.
ck_eq "exactly one concurrent manual trigger was skipped by the leader lock" "$SKIPPED_COUNT" "1"

# The WINNER (the one that was NOT skipped) must have done real, non-trivial
# work — proves this isn't "both silently no-op".
FOUND1=$(echo "$BODY1" | jq -r '.metrics.stuckStepsFound // 0')
FOUND2=$(echo "$BODY2" | jq -r '.metrics.stuckStepsFound // 0')
WINNER_FOUND=$((FOUND1 > FOUND2 ? FOUND1 : FOUND2))
ck "the winner actually detected the seeded stuck steps (stuckStepsFound >= ${STUCK_STEPS})" \
  test "$WINNER_FOUND" -ge "$STUCK_STEPS"

# --- cleanup: remove the synthetic seed data (best-effort, non-fatal) -------
docker exec "$DB_CONTAINER" psql -U "$PGUSER" -d "$PGDB" -c \
  "DELETE FROM dtm_jobs WHERE payload->>'se' = 'SE-15';" >/dev/null 2>&1 || true

se_summary
