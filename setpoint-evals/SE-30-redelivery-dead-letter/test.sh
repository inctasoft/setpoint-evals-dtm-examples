#!/usr/bin/env bash
# SE-30: redelivery dead letter — with the redelivery engine forced on, a step
# whose worker fails EVERY attempt exhausts the synthetic attempt counter and
# lands as a row in dtm_dead_letters (step goes FAILED, job goes FAILED) —
# the bus-neutral replacement for SQS DLQ routing (SE-02). Restores
# orchestrator env afterward no matter what (trap).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq/ck_has (pipefail-safe, mutate counters — never call in $()), se_skip, se_summary.
# NOTE: this SE is FLAT under setpoint-evals/ (SE-01..SE-30 convention), so se-lib.sh is 2
# levels up (mirrors SE-14/SE-15/SE-19's own path comment).
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-30: redelivery engine dead-letters a step that exhausts its attempts"

ENV_FILE="$ROOT/.env"
COMPOSE_MAIN="$ROOT/docker-compose.yml"
ENV_BACKUP=""
PROJECT="${COMPOSE_PROJECT_NAME:-dtm}"
LEASE_SECONDS=5

# --- preflight ---------------------------------------------------------------
[ -f "$ENV_FILE" ] || se_skip "no .env at repo root — cannot safely flip orchestrator env without one"
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
docker compose version >/dev/null 2>&1 || se_skip "docker compose CLI not available"

psql_core() {
  docker exec "${PROJECT}-db" psql -U dtm_user -d dtm -tAc "$1"
}

DEAD_LETTERS_TABLE="$(psql_core "SELECT table_name FROM information_schema.tables WHERE table_name='dtm_dead_letters';" 2>/dev/null | tr -d '[:space:]')"
[ "$DEAD_LETTERS_TABLE" = "dtm_dead_letters" ] \
  || se_skip "dtm_dead_letters missing — stack images predate the redelivery migration (rebuild init-typeorm and restart the stack)"

# --- arrange: snapshot .env so it can be restored no matter what happens -----
ENV_BACKUP="$(mktemp)"
cp "$ENV_FILE" "$ENV_BACKUP"

wait_for_orchestrator_health() {
  local tries=0
  until curl -sf -m 3 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -gt 60 ] && return 1
    sleep 2
  done
  return 0
}

set_engine_env_and_recreate() {
  local force="$1"
  sed -i '/^REDELIVERY_ENGINE_FORCE_ENABLED=/d;/^REDELIVERY_LEASE_SECONDS=/d' "$ENV_FILE"
  printf '\nREDELIVERY_ENGINE_FORCE_ENABLED=%s\nREDELIVERY_LEASE_SECONDS=%s\n' "$force" "$LEASE_SECONDS" >> "$ENV_FILE"
  ( cd "$ROOT" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" \
      --profile db --profile orchestrator --profile dev-tools \
      up -d --no-deps --force-recreate orchestrator ) >/dev/null
  wait_for_orchestrator_health
}

restore_all() {
  if [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
    cp "$ENV_BACKUP" "$ENV_FILE"
    rm -f "$ENV_BACKUP"
  fi
  ( cd "$ROOT" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" \
      --profile db --profile orchestrator --profile dev-tools \
      up -d --no-deps --force-recreate orchestrator ) >/dev/null 2>&1 || true
  wait_for_orchestrator_health || log_warn "orchestrator did not confirm healthy during final restore"
}
trap restore_all EXIT

set_engine_env_and_recreate "true" \
  || { log_fail "orchestrator did not come back healthy with the engine forced on"; exit 1; }

# --- act: a worker that fails EVERY attempt ----------------------------------
# NOTE: every engine re-dispatch is a FRESH bus message, so the worker always
# sees delivery attempt 1 — failOnAttempts: [1] fails every single attempt.
EXTERNAL_SYSTEM_ID=$(uuidgen)
PAYLOAD=$(cat <<EOF
{
  "variant": "quick-order",
  "payload": { "customerId": 1, "orderId": 1, "entityId": "$EXTERNAL_SYSTEM_ID" },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500, "failOnAttempts": [1] },
    "ValidateProduct": { "simDelay": 500 },
    "SubmitCustomer": { "simDelay": 500, "ackDelay": 500 },
    "SubmitOrder": { "simDelay": 500, "ackDelay": 500 }
  }
}
EOF
)

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || { log_fail "job initiation failed"; exit 1; }
validate_job_id "$JOB_ID" || { log_fail "invalid job id"; exit 1; }

# Drive the engine manually between lease expiries (deterministic — no 30s cron waits)
DEAD_LETTER_ROWS=0
for _ in $(seq 1 12); do
  DEAD_LETTER_ROWS="$(psql_core "SELECT COUNT(*) FROM dtm_dead_letters WHERE job_id='$JOB_ID';" | tr -d '[:space:]')"
  [ "${DEAD_LETTER_ROWS:-0}" -ge 1 ] && break
  sleep $((LEASE_SECONDS + 2))
  curl -s -o /dev/null -X POST -H "Content-Type: application/json" -d '{}' \
    "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/redelivery-engine/execute"
done

DEAD_LETTER_ROW="$(psql_core "SELECT step_value || '|' || attempt_count || '|' || workflow_name FROM dtm_dead_letters WHERE job_id='$JOB_ID' LIMIT 1;")"
STEP_STATUS="$(psql_core "SELECT status FROM dtm_steps WHERE job_id='$JOB_ID' AND step_value='ValidateCustomer' LIMIT 1;" | tr -d '[:space:]')"
JOB_STATUS="$(extract_job_status "$(get_job_status "$JOB_ID")")"
RE_DISPATCH_ATTEMPTS="$(psql_core "SELECT COALESCE(MAX(attempt_count),0) FROM dtm_steps WHERE job_id='$JOB_ID';" | tr -d '[:space:]')"

# --- assert (1:1 with the README checkbox list) --------------------------------
ck "exhaustion landed a row in dtm_dead_letters" test "${DEAD_LETTER_ROWS:-0}" -ge 1
ck_eq "the dead letter names the failing step, its exhausted attempt count, and the workflow" \
  "$DEAD_LETTER_ROW" "ValidateCustomer|3|order-processing"
ck_eq "the step is FAILED after exhaustion" "${STEP_STATUS,,}" "failed"
ck_eq "the job is FAILED after the step dead-lettered" "${JOB_STATUS,,}" "failed"
ck "the engine re-dispatched up to the attempt ceiling (no infinite redelivery)" test "${RE_DISPATCH_ATTEMPTS:-0}" -le 3

se_summary
