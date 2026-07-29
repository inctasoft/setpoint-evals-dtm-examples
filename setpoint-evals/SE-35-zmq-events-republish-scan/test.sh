#!/usr/bin/env bash
# SE-35: zmq events republish scan — full-zmq profile with a short republish
# lease; the dev-ack-simulator is STOPPED when the first cascade publish
# fires (PUB/SUB silently drops it), the step sits WAITING_FOR_ACK, and the
# EventRepublishScanTask re-publishes it — once the simulator is back and
# subscribed, a re-publish lands, the ACK arrives, and the job completes WELL
# BEFORE the 30-minute stuck-ack timeout. RED-first by construction (without
# the scan the step stalls for 30 minutes and then auto-fails). Restores
# .env, orchestrator, simulator, and worker hosts afterward (EXIT trap).
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

log_info "SE-35: zmq events republish scan — dropped publish recovered before the 30-min timeout"

ENV_FILE="$ROOT/.env"
COMPOSE_MAIN="$ROOT/docker-compose.yml"
COMPOSE_ZMQ="$ROOT/docker-compose.zmq.yml"
ENV_BACKUP=""
PROJECT="${COMPOSE_PROJECT_NAME:-dtm}"
REPUB_LEASE=10

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

restore_all() {
  docker start "${PROJECT}-dev-ack-simulator" >/dev/null 2>&1 || true
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
}
trap restore_all EXIT

# --- arrange: full-zmq profile with a short republish lease ------------------
sed -i '/^QUEUE_TRANSPORT=/d;/^EVENT_BUS=/d;/^EVENT_REPUBLISH_LEASE_SECONDS=/d' "$ENV_FILE"
printf '\nQUEUE_TRANSPORT=zmq\nEVENT_BUS=zmq\nEVENT_REPUBLISH_LEASE_SECONDS=%s\n' "$REPUB_LEASE" >> "$ENV_FILE"

zmq_compose up -d --no-deps --force-recreate orchestrator dev-ack-simulator
wait_for_orchestrator_health \
  || { log_fail "orchestrator did not come back healthy under EVENT_BUS=zmq"; exit 1; }

zmq_compose up -d \
  zmq-worker-host-order-processing \
  zmq-worker-host-iot-sensor-pipeline \
  zmq-worker-host-infra-provisioning

# Wait for the worker fleet to HELLO-register
for _ in $(seq 1 30); do
  ALIVE="$(curl -s -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workers" | jq '[.[] | select(.state == "alive")] | length' 2>/dev/null || echo 0)"
  [ "${ALIVE:-0}" -ge 3 ] && break
  sleep 2
done

# --- act: no subscriber when the first publish fires --------------------------
docker stop "${PROJECT}-dev-ack-simulator" >/dev/null

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

# Wait until a step is parked in WAITING_FOR_ACK with no ACK (publish dropped)
WAITING="0"
for _ in $(seq 1 20); do
  WAITING="$(psql_steps "SELECT COUNT(*) FROM dtm_steps WHERE job_id='$JOB_ID' AND status='waiting_for_ack' AND ack_received_at IS NULL;" | tr -d '[:space:]')"
  [ "${WAITING:-0}" -ge 1 ] && break
  sleep 1
done

# Let the republish lease expire, then fire the scan (first re-publish drops too)
sleep $((REPUB_LEASE + 3))
SCAN1="$(curl -s -X POST -H "Content-Type: application/json" -d '{}' \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/event-republish-scan/execute")"
SCAN1_SUCCESS="$(echo "$SCAN1" | jq -r '.success // false')"
SCAN1_FOUND="$(echo "$SCAN1" | jq -r '.metrics.expiredPublishesFound // 0')"
SCAN1_REPUB="$(echo "$SCAN1" | jq -r '.metrics.republished // 0')"

# --- act: the subscriber returns; the next scan's re-publish lands ------------
docker start "${PROJECT}-dev-ack-simulator" >/dev/null
# SUB connect + subscription propagation settle
sleep 8

curl -s -X POST -H "Content-Type: application/json" -d '{}' \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/event-republish-scan/execute" >/dev/null

JOB_FINAL="processing"
for _ in $(seq 1 60); do
  JOB_FINAL="$(extract_job_status "$(get_job_status "$JOB_ID")")"
  [ "${JOB_FINAL,,}" = "completed" ] && break
  [ "${JOB_FINAL,,}" = "failed" ] && break
  sleep 2
done

ACKED="$(psql_steps "SELECT COUNT(*) FROM dtm_steps WHERE job_id='$JOB_ID' AND ack_received_at IS NOT NULL;" | tr -d '[:space:]')"
DEAD_LETTERS="$(psql_steps "SELECT COUNT(*) FROM dtm_dead_letters WHERE job_id='$JOB_ID';" | tr -d '[:space:]')"

# --- assert (1:1 with the README checkbox list) --------------------------------
ck "a step parked in WAITING_FOR_ACK with no ACK while the subscriber was down" test "${WAITING:-0}" -ge 1
ck_eq "the republish scan executed successfully (auto-on under zmq events)" "$SCAN1_SUCCESS" "true"
ck "the scan found the expired un-ACKed publish" test "${SCAN1_FOUND:-0}" -ge 1
ck "the scan re-published the dropped event" test "${SCAN1_REPUB:-0}" -ge 1
ck "the ACK arrived after the subscriber returned (ack_received_at set)" test "${ACKED:-0}" -ge 1
ck_eq "the job completed via re-publish — not via the 30-min stuck-ack auto-fail" "${JOB_FINAL,,}" "completed"
ck_eq "no step was dead-lettered or auto-failed on the way" "$DEAD_LETTERS" "0"

se_summary
