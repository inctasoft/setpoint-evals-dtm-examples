#!/usr/bin/env bash
# SE-34: zmq events e2e — full-zmq profile (QUEUE_TRANSPORT=zmq + EVENT_BUS=zmq):
# an order-processing quick-order job completes end-to-end INCLUDING the
# acknowledgement roundtrip through ZmqEventBus (orchestrator PUB → simulator
# SUB → simulator PUSH → orchestrator PULL). Restores .env, orchestrator,
# dev-ack-simulator, and worker hosts afterward no matter what (EXIT trap) —
# mirrors the env-flip + restore discipline of SE-31..33.
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

log_info "SE-34: zmq events e2e — quick-order completes with the ACK roundtrip over ZmqEventBus"

ENV_FILE="$ROOT/.env"
COMPOSE_MAIN="$ROOT/docker-compose.yml"
COMPOSE_ZMQ="$ROOT/docker-compose.zmq.yml"
ENV_BACKUP=""
PROJECT="${COMPOSE_PROJECT_NAME:-dtm}"

# --- preflight ---------------------------------------------------------------
[ -f "$ENV_FILE" ] || se_skip "no .env at repo root — cannot safely flip orchestrator env without one"
[ -f "$COMPOSE_ZMQ" ] || se_skip "no docker-compose.zmq.yml at repo root — the zmq profiles are missing"
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
docker compose version >/dev/null 2>&1 || se_skip "docker compose CLI not available"
docker image inspect dtm-zmq-worker-host:latest >/dev/null 2>&1 \
  || se_skip "dtm-zmq-worker-host:latest missing — build it: docker compose -f docker-compose.zmq.yml build zmq-worker-host-order-processing"

psql_steps() {
  docker exec "${PROJECT}-db" psql -U dtm_user -d dtm -tAc "$1"
}

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


# Restore the worker fleet when the OUTER stack profile needs it: the trap
# restores .env to its pre-SE state; if that state runs zmq tasks
# (BUS_PROFILE=zmq or QUEUE_TRANSPORT=zmq), a bare `rm -sf` would leave every
# SUBSEQUENT eval workerless (estate poisoning — observed live as SE-10/17
# stalling after SE-34's trap). Under an aws restored .env the fleet stays
# down, matching the pre-SE state.
restore_workers_if_profile_needs() {
  grep -qE '^BUS_PROFILE=zmq|^QUEUE_TRANSPORT=zmq' "$ENV_FILE" || return 0
  zmq_compose up -d \
    zmq-worker-host-order-processing \
    zmq-worker-host-iot-sensor-pipeline \
    zmq-worker-host-infra-provisioning >/dev/null 2>&1 || true
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
      up -d --no-deps --force-recreate orchestrator dev-ack-simulator ) >/dev/null 2>&1 || true
  wait_for_orchestrator_health || log_warn "orchestrator did not confirm healthy during final restore"
  restore_workers_if_profile_needs
}
trap restore_all EXIT

# --- arrange: full-zmq profile ------------------------------------------------
sed -i '/^QUEUE_TRANSPORT=/d;/^EVENT_BUS=/d' "$ENV_FILE"
printf '\nQUEUE_TRANSPORT=zmq\nEVENT_BUS=zmq\n' >> "$ENV_FILE"

zmq_compose up -d --no-deps --force-recreate orchestrator dev-ack-simulator
wait_for_orchestrator_health \
  || { log_fail "orchestrator did not come back healthy under EVENT_BUS=zmq"; exit 1; }

zmq_compose up -d \
  zmq-worker-host-order-processing \
  zmq-worker-host-iot-sensor-pipeline \
  zmq-worker-host-infra-provisioning

# Wait for the worker fleet to HELLO-register
ALIVE=0
for _ in $(seq 1 30); do
  WORKERS_JSON="$(curl -s -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workers")"
  ALIVE="$(echo "$WORKERS_JSON" | jq '[.[] | select(.state == "alive")] | length' 2>/dev/null || echo 0)"
  [ "${ALIVE:-0}" -ge 3 ] && break
  sleep 2
done

# Give the simulator's SUB a moment to attach before any publish fires.
# Poll for the client's boot line instead of a one-shot capture — the
# simulator boots slower than the orchestrator's health gate, and under the
# full-suite matrix its recreate races the log read (observed FAIL live).
sleep 5
ORCH_LOGS="$(docker logs "${PROJECT}-orchestrator" 2>&1 | tail -300)"
SIM_LOGS=""
for _ in $(seq 1 15); do
  SIM_LOGS="$(docker logs "${PROJECT}-dev-ack-simulator" 2>&1 | tail -300)"
  echo "$SIM_LOGS" | grep -q "ZmqEventBusClient connected" && break
  sleep 2
done

# --- act: quick-order end-to-end over both zmq buses --------------------------
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

PUBLISHED_STEPS="$(psql_steps "SELECT COUNT(*) FROM dtm_steps WHERE job_id='$JOB_ID' AND kafka_published_at IS NOT NULL;" | tr -d '[:space:]')"
ACKED_STEPS="$(psql_steps "SELECT COUNT(*) FROM dtm_steps WHERE job_id='$JOB_ID' AND ack_received_at IS NOT NULL;" | tr -d '[:space:]')"

# --- assert (1:1 with the README checkbox list) --------------------------------
ck_has "the orchestrator booted the ZeroMQ event bus (PUB + PULL bound)" "$ORCH_LOGS" "ZmqEventBus bound"
ck_has "the dev-ack-simulator connected over zmq (SUB + PUSH)" "$SIM_LOGS" "ZmqEventBusClient connected"
ck "the zmq worker fleet is alive under the full-zmq profile" test "${ALIVE:-0}" -ge 3
ck_eq "the quick-order job completed over zmq events (ACK roundtrip included)" "${JOB_FINAL,,}" "completed"
ck "a submit step carries the publish marker (kafka_published_at)" test "${PUBLISHED_STEPS:-0}" -ge 1
ck "a submit step carries the ack marker (ack_received_at via ZmqEventBus)" test "${ACKED_STEPS:-0}" -ge 1

se_summary
