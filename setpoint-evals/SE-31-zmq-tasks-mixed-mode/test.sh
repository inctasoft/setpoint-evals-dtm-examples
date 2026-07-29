#!/usr/bin/env bash
# SE-31: zmq tasks mixed mode — with QUEUE_TRANSPORT=zmq on the orchestrator
# and the zmq-tasks compose profile up (one zmq-worker-host per workflow, NO
# sqs-poller containers running), an order-processing quick-order job runs
# end-to-end over the ZeroMQ task path (Kafka events untouched). Restores
# .env, orchestrator, worker hosts, and pollers afterward no matter what
# (EXIT trap) — mirrors the env-flip + restore discipline of SE-29/SE-30.
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

log_info "SE-31: zmq tasks mixed mode — quick-order over ZeroMQ, no sqs-poller running"

ENV_FILE="$ROOT/.env"
COMPOSE_MAIN="$ROOT/docker-compose.yml"
COMPOSE_ZMQ="$ROOT/docker-compose.zmq.yml"
ENV_BACKUP=""
PROJECT="${COMPOSE_PROJECT_NAME:-dtm}"

# --- preflight ---------------------------------------------------------------
[ -f "$ENV_FILE" ] || se_skip "no .env at repo root — cannot safely flip orchestrator env without one"
[ -f "$COMPOSE_ZMQ" ] || se_skip "no docker-compose.zmq.yml at repo root — the zmq-tasks profile is missing"
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
docker compose version >/dev/null 2>&1 || se_skip "docker compose CLI not available"
docker image inspect dtm-zmq-worker-host:latest >/dev/null 2>&1 || {
  log_info "dtm-zmq-worker-host:latest missing — building it now (one-time)"
  ( cd "$ROOT" && docker compose -f "$COMPOSE_ZMQ" build zmq-worker-host-order-processing ) >/dev/null \
    || se_skip "could not build the zmq-worker-host image"
}

POLLER_IDS="$(docker ps -q --filter "name=${PROJECT}-sqs-poller")"

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
  # Worker hosts first (nothing asserts during restore — best effort, never mask the verdict)
  zmq_compose rm -sf \
    zmq-worker-host-order-processing \
    zmq-worker-host-iot-sensor-pipeline \
    zmq-worker-host-infra-provisioning >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  [ -n "$POLLER_IDS" ] && docker start $POLLER_IDS >/dev/null 2>&1 || true
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

# --- arrange: flip to the zmq task transport and bring mixed mode up ---------
sed -i '/^QUEUE_TRANSPORT=/d' "$ENV_FILE"
printf '\nQUEUE_TRANSPORT=zmq\n' >> "$ENV_FILE"

zmq_compose up -d --no-deps --force-recreate orchestrator
wait_for_orchestrator_health \
  || { log_fail "orchestrator did not come back healthy under QUEUE_TRANSPORT=zmq"; exit 1; }

zmq_compose up -d \
  zmq-worker-host-order-processing \
  zmq-worker-host-iot-sensor-pipeline \
  zmq-worker-host-infra-provisioning

# Wait for the fleet to HELLO-register (registry is the source of truth)
WORKERS_JSON="[]"
for _ in $(seq 1 30); do
  WORKERS_JSON="$(curl -s -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workers")"
  ALIVE="$(echo "$WORKERS_JSON" | jq '[.[] | select(.state == "alive")] | length' 2>/dev/null || echo 0)"
  [ "${ALIVE:-0}" -ge 3 ] && break
  sleep 2
done

ORCH_LOGS="$(docker logs "${PROJECT}-orchestrator" 2>&1 | tail -200)"
QUEUE_SERVED="$(echo "$WORKERS_JSON" | jq '[.[] | select(.state == "alive") | .queues[] | select(. == "order-validate-customer")] | length' 2>/dev/null || echo 0)"

# --- act: no SQS poller may participate in the task path ----------------------
# shellcheck disable=SC2086
[ -n "$POLLER_IDS" ] && docker stop $POLLER_IDS >/dev/null || true
RUNNING_POLLERS="$(docker ps -q --filter "name=${PROJECT}-sqs-poller" | wc -l | tr -d ' ')"

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

JOB_FINAL="processing"
for _ in $(seq 1 60); do
  JOB_FINAL="$(extract_job_status "$(get_job_status "$JOB_ID")")"
  [ "${JOB_FINAL,,}" = "completed" ] && break
  [ "${JOB_FINAL,,}" = "failed" ] && break
  sleep 2
done

HOST_LOGS="$(docker logs "$(docker ps -q --filter "name=${PROJECT}-zmq-worker-host-order-processing" | head -1)" 2>&1 || true)"

# --- assert (1:1 with the README checkbox list) --------------------------------
ck_has "the orchestrator booted the ZeroMQ ROUTER transport" "$ORCH_LOGS" "ZmqTransport ROUTER bound"
ck "the worker registry lists at least 3 live workers (one per workflow)" test "${ALIVE:-0}" -ge 3
ck "an order-processing worker serves the order-validate-customer queue" test "${QUEUE_SERVED:-0}" -ge 1
ck_eq "no sqs-poller container was running during the job" "$RUNNING_POLLERS" "0"
ck_eq "the quick-order job completed over the zmq task path" "${JOB_FINAL,,}" "completed"
ck_has "the order-processing worker-host logged a task for order-validate-customer" "$HOST_LOGS" "order-validate-customer"

se_summary
