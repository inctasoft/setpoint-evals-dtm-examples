#!/usr/bin/env bash
# SE-29: redelivery lease expiry — with the redelivery engine forced on and a
# short delegation lease, a step whose worker never calls back (pollers
# stopped) is re-dispatched by the engine (attempt_count increments, lease
# refreshes) and still completes once the pollers return. Restores
# orchestrator env + pollers afterward no matter what (trap).
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

log_info "SE-29: redelivery engine re-dispatches lease-expired steps (pollers down, then back)"

ENV_FILE="$ROOT/.env"
COMPOSE_MAIN="$ROOT/docker-compose.yml"
ENV_BACKUP=""
PROJECT="${COMPOSE_PROJECT_NAME:-dtm}"
LEASE_SECONDS=5

# --- preflight ---------------------------------------------------------------
[ -f "$ENV_FILE" ] || se_skip "no .env at repo root — cannot safely flip orchestrator env without one"
# Retry-poll (loaded hosts boot the orchestrator slowly after recreate-heavy SEs)
se_wait_orchestrator_health 90 2 \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
docker compose version >/dev/null 2>&1 || se_skip "docker compose CLI not available"

psql_steps() {
  docker exec "${PROJECT}-db" psql -U dtm_user -d dtm -tAc "$1"
}

ATTEMPT_COL="$(psql_steps "SELECT column_name FROM information_schema.columns WHERE table_name='dtm_steps' AND column_name='attempt_count';" 2>/dev/null | tr -d '[:space:]')"
[ "$ATTEMPT_COL" = "attempt_count" ] \
  || se_skip "dtm_steps.attempt_count missing — stack images predate the redelivery migration (rebuild init-typeorm and restart the stack)"

POLLER_IDS="$(docker ps -q --filter "name=${PROJECT}-sqs-poller")"
[ -n "$POLLER_IDS" ] || se_skip "no ${PROJECT}-sqs-poller containers running — this SE needs pollers to stop and restart"

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
  # Pollers first (nothing asserts during restore — best effort, never mask the verdict)
  docker start $POLLER_IDS >/dev/null 2>&1 || true
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

# --- act: no worker ever picks the task up -----------------------------------
# shellcheck disable=SC2086
docker stop $POLLER_IDS >/dev/null

EXTERNAL_SYSTEM_ID=$(uuidgen)
PAYLOAD=$(cat <<EOF
{
  "variant": "quick-order",
  "payload": { "customerId": 1, "orderId": 1, "entityId": "$EXTERNAL_SYSTEM_ID" },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500 },
    "ValidateProduct": { "simDelay": 500 },
    "SubmitCustomer": { "simDelay": 500, "ackDelay": 500 },
    "SubmitOrder": { "simDelay": 500, "ackDelay": 500 }
  }
}
EOF
)

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || { log_fail "job initiation failed"; exit 1; }
validate_job_id "$JOB_ID" || { log_fail "invalid job id"; exit 1; }

# Wait past the lease so the engine's scan sees an expired lease
sleep $((LEASE_SECONDS + 3))

# Poll the manual trigger until a re-dispatch is reported (bounded): on a
# loaded host the one-shot call can land just before the lease flips past NOW —
# the 30s cron then does the redispatch (observed live as reDispatched=0 with
# attempt_count >= 2 arriving later).
TASK_RESULT=""
TASK_SUCCESS="false"
RE_DISPATCHED=0
for _ in $(seq 1 6); do
  TASK_RESULT="$(curl -s -X POST -H "Content-Type: application/json" -d '{}' \
    "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/redelivery-engine/execute")"
  TASK_SUCCESS="$(echo "$TASK_RESULT" | jq -r '.success // false')"
  RE_DISPATCHED="$(echo "$TASK_RESULT" | jq -r '.metrics.reDispatched // 0')"
  [ "${RE_DISPATCHED:-0}" -ge 1 ] && break
  sleep 10
done

ATTEMPT_COUNT="$(psql_steps "SELECT COALESCE(MAX(attempt_count),0) FROM dtm_steps WHERE job_id='$JOB_ID';" | tr -d '[:space:]')"
LEASE_FUTURE="$(psql_steps "SELECT COUNT(*) FROM dtm_steps WHERE job_id='$JOB_ID' AND lease_expires_at > NOW();" | tr -d '[:space:]')"

# --- act: workers return ------------------------------------------------------
# shellcheck disable=SC2086
docker start $POLLER_IDS >/dev/null

JOB_FINAL="processing"
for _ in $(seq 1 45); do
  JOB_FINAL="$(extract_job_status "$(get_job_status "$JOB_ID")")"
  [ "${JOB_FINAL,,}" = "completed" ] && break
  [ "${JOB_FINAL,,}" = "failed" ] && break
  sleep 2
done

FINAL_ATTEMPTS="$(psql_steps "SELECT COALESCE(MAX(attempt_count),0) FROM dtm_steps WHERE job_id='$JOB_ID';" | tr -d '[:space:]')"

# --- assert (1:1 with the README checkbox list) --------------------------------
ck_eq "the maintenance task executed successfully" "$TASK_SUCCESS" "true"
ck "the engine re-dispatched at least one lease-expired step" test "$RE_DISPATCHED" -ge 1
ck "the synthetic attempt counter incremented past the initial dispatch" test "${ATTEMPT_COUNT:-0}" -ge 2
ck "the re-dispatch refreshed the delegation lease into the future" test "${LEASE_FUTURE:-0}" -ge 1
ck_eq "the job completed once the pollers returned" "${JOB_FINAL,,}" "completed"
ck "the attempt counter stayed above one dispatch (redelivery, not a fresh step)" test "${FINAL_ATTEMPTS:-0}" -ge 2

se_summary
