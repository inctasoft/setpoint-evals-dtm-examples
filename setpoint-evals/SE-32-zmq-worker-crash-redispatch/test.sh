#!/usr/bin/env bash
# SE-32: zmq worker crash redispatch — mixed mode up with TWO order-processing
# worker-host replicas; the replica holding a mid-flight task (simDelay window)
# is docker-killed; the Phase 1 redelivery engine (AUTO-ON under zmq — the
# transport declares redelivery: 'orchestrator', no FORCE flag needed)
# re-dispatches the step on lease expiry and the job completes via the
# surviving/restarted replica. Restores .env, orchestrator, and worker hosts
# afterward no matter what (EXIT trap).
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

log_info "SE-32: zmq worker crash — redelivery engine re-dispatches a mid-flight task"

ENV_FILE="$ROOT/.env"
COMPOSE_MAIN="$ROOT/docker-compose.yml"
COMPOSE_ZMQ="$ROOT/docker-compose.zmq.yml"
ENV_BACKUP=""
PROJECT="${COMPOSE_PROJECT_NAME:-dtm}"
LEASE_SECONDS=5

# --- preflight ---------------------------------------------------------------
[ -f "$ENV_FILE" ] || se_skip "no .env at repo root — cannot safely flip orchestrator env without one"
[ -f "$COMPOSE_ZMQ" ] || se_skip "no docker-compose.zmq.yml at repo root — the zmq-tasks profile is missing"
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
docker compose version >/dev/null 2>&1 || se_skip "docker compose CLI not available"
docker image inspect dtm-zmq-worker-host:latest >/dev/null 2>&1 \
  || se_skip "dtm-zmq-worker-host:latest missing — build it: docker compose -f docker-compose.zmq.yml build zmq-worker-host-order-processing"

psql_steps() {
  docker exec "${PROJECT}-db" psql -U dtm_user -d dtm -tAc "$1"
}

ATTEMPT_COL="$(psql_steps "SELECT column_name FROM information_schema.columns WHERE table_name='dtm_steps' AND column_name='attempt_count';" 2>/dev/null | tr -d '[:space:]')"
[ "$ATTEMPT_COL" = "attempt_count" ] \
  || se_skip "dtm_steps.attempt_count missing — stack images predate the redelivery migration (rebuild init-typeorm and restart the stack)"

# --- arrange: snapshot .env so it can be restored no matter what happens -----
ENV_BACKUP="$(mktemp)"
cp "$ENV_FILE" "$ENV_BACKUP"

zmq_compose() {
  ( cd "$ROOT" && docker compose --env-file "$ENV_FILE" \
      -f "$COMPOSE_MAIN" -f "$COMPOSE_ZMQ" \
      --profile db --profile orchestrator --profile dev-tools --profile zmq-tasks "$@" ) >/dev/null
}

wait_for_orchestrator_health() {
  local tries=0
  until curl -sf -m 3 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -gt 60 ] && return 1
    sleep 2
  done
  return 0
}

restore_all() {
  zmq_compose rm -sf \
    zmq-worker-host-order-processing \
    zmq-worker-host-iot-sensor-pipeline \
    zmq-worker-host-infra-provisioning >/dev/null 2>&1 || true
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

# --- arrange: zmq transport + short lease + fast death detection -------------
# REDELIVERY_LEASE_SECONDS=5: the engine sees the crashed worker's step quickly.
# ZMQ_WORKER_SILENCE_MS=3000: the dead replica is unrouted BEFORE the manual
# engine trigger, so the re-dispatch can only land on a live replica.
sed -i '/^QUEUE_TRANSPORT=/d;/^REDELIVERY_LEASE_SECONDS=/d;/^ZMQ_WORKER_SILENCE_MS=/d;/^ZMQ_WORKER_SWEEP_INTERVAL_MS=/d' "$ENV_FILE"
printf '\nQUEUE_TRANSPORT=zmq\nREDELIVERY_LEASE_SECONDS=%s\nZMQ_WORKER_SILENCE_MS=3000\nZMQ_WORKER_SWEEP_INTERVAL_MS=1000\n' "$LEASE_SECONDS" >> "$ENV_FILE"

zmq_compose up -d --no-deps --force-recreate orchestrator
wait_for_orchestrator_health \
  || { log_fail "orchestrator did not come back healthy under QUEUE_TRANSPORT=zmq"; exit 1; }

zmq_compose up -d --scale zmq-worker-host-order-processing=2 \
  zmq-worker-host-order-processing \
  zmq-worker-host-iot-sensor-pipeline \
  zmq-worker-host-infra-provisioning

# Wait for BOTH order-processing replicas to HELLO-register
OP_REPLICAS=0
for _ in $(seq 1 30); do
  WORKERS_JSON="$(curl -s -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workers")"
  OP_REPLICAS="$(echo "$WORKERS_JSON" | jq '[.[] | select(.state == "alive") | select(.workerId | startswith("order-processing"))] | length' 2>/dev/null || echo 0)"
  [ "${OP_REPLICAS:-0}" -ge 2 ] && break
  sleep 2
done

ORCH_LOGS="$(docker logs "${PROJECT}-orchestrator" 2>&1 | tail -200)"

# --- act: a slow task is dispatched, then its worker dies mid-flight ---------
EXTERNAL_SYSTEM_ID=$(uuidgen)
PAYLOAD=$(cat <<EOF
{
  "variant": "quick-order",
  "payload": { "customerId": 1, "orderId": 1, "entityId": "$EXTERNAL_SYSTEM_ID" },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 13000 },
    "ValidateProduct": { "simDelay": 500 },
    "SubmitCustomer": { "simDelay": 500, "ackDelay": 500 },
    "SubmitOrder": { "simDelay": 500, "ackDelay": 500 }
  }
}
EOF
)

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || { log_fail "job initiation failed"; exit 1; }
validate_job_id "$JOB_ID" || { log_fail "invalid job id"; exit 1; }

# Find the replica holding the ValidateCustomer task (simDelay = our kill window)
VICTIM=""
VICTIM_LOGS=""
for _ in $(seq 1 15); do
  for CID in $(docker ps -q --filter "name=${PROJECT}-zmq-worker-host-order-processing"); do
    LOGS="$(docker logs "$CID" 2>&1)"
    if echo "$LOGS" | grep -q "order-validate-customer] Task"; then
      VICTIM="$CID"
      VICTIM_LOGS="$LOGS"
      break
    fi
  done
  [ -n "$VICTIM" ] && break
  sleep 1
done
[ -n "$VICTIM" ] || { log_fail "no order-processing replica picked up the ValidateCustomer task"; exit 1; }

docker kill "$VICTIM" >/dev/null

# Wait past the lease AND the silence window: the step is lease-expired and the
# dead replica is unrouted, so the re-dispatch must land on a live replica.
sleep $((LEASE_SECONDS + 4))

TASK_RESULT="$(curl -s -X POST -H "Content-Type: application/json" -d '{}' \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/redelivery-engine/execute")"
TASK_SUCCESS="$(echo "$TASK_RESULT" | jq -r '.success // false')"
RE_DISPATCHED="$(echo "$TASK_RESULT" | jq -r '.metrics.reDispatched // 0')"

# Race note: the engine ALSO runs on a 30s cron. If a cron tick re-dispatched
# the lease-expired step before this manual trigger, the manual call honestly
# reports reDispatched=0 — the re-dispatch already happened. The contract is
# "the engine re-dispatched the crashed worker's step" by EITHER path, so
# count the orchestrator's own re-dispatch log lines as proof too.
ENGINE_LOGS="$(docker logs "${PROJECT}-orchestrator" --since 3m 2>&1 || true)"
CRON_RE_DISPATCHED="$(echo "$ENGINE_LOGS" | grep -c "Re-dispatching lease-expired step" || true)"

ATTEMPT_COUNT="$(psql_steps "SELECT COALESCE(MAX(attempt_count),0) FROM dtm_steps WHERE job_id='$JOB_ID';" | tr -d '[:space:]')"

JOB_FINAL="processing"
for _ in $(seq 1 75); do
  JOB_FINAL="$(extract_job_status "$(get_job_status "$JOB_ID")")"
  [ "${JOB_FINAL,,}" = "completed" ] && break
  [ "${JOB_FINAL,,}" = "failed" ] && break
  sleep 2
done

# --- assert (1:1 with the README checkbox list) --------------------------------
ck_has "the orchestrator booted the ZeroMQ ROUTER transport" "$ORCH_LOGS" "ZmqTransport ROUTER bound"
ck "two order-processing replicas were registered before the crash" test "${OP_REPLICAS:-0}" -ge 2
ck_has "the ValidateCustomer task reached a replica before the kill" "$VICTIM_LOGS" "order-validate-customer] Task"
ck_eq "the redelivery engine executed successfully (auto-on under zmq)" "$TASK_SUCCESS" "true"
ck "the engine re-dispatched the crashed worker's lease-expired step (manual trigger or 30s cron — first to win)" test "$(( ${RE_DISPATCHED:-0} + ${CRON_RE_DISPATCHED:-0} ))" -ge 1
ck "the synthetic attempt counter proves a re-dispatch (attempt_count >= 2)" test "${ATTEMPT_COUNT:-0}" -ge 2
ck_eq "the job completed after losing a worker mid-task" "${JOB_FINAL,,}" "completed"

se_summary
