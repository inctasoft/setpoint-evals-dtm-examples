#!/usr/bin/env bash
# SE-36: full-zmq bus profile — bring the stack up with BUS_PROFILE=zmq and NO
# broker containers at all (kafka, zookeeper, kafka-ui, localstack AND every
# sqs-poller stopped), prove the umbrella expands (no explicit
# QUEUE_TRANSPORT/EVENT_BUS set), prove health/readiness degrade honestly
# with Kafka down, and run a quick-order job end-to-end on a single docker
# network with zero brokers. Restores .env, broker containers, orchestrator,
# simulator, and worker hosts afterward no matter what (EXIT trap).
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

log_info "SE-36: full-zmq bus profile — zero brokers, umbrella expansion, honest health, job e2e"

ENV_FILE="$ROOT/.env"
COMPOSE_MAIN="$ROOT/docker-compose.yml"
COMPOSE_ZMQ="$ROOT/docker-compose.zmq.yml"
ENV_BACKUP=""
PROJECT="${COMPOSE_PROJECT_NAME:-dtm}"
BROKER_CONTAINERS="${PROJECT}-kafka ${PROJECT}-zookeeper ${PROJECT}-kafka-ui ${PROJECT}-localstack"

# --- preflight ---------------------------------------------------------------
# GATE: aws-profile runs must skip — this SE stops LocalStack mid-suite and
# PERSISTENCE=0 wipes every deployed Lambda, poisoning later aws-leg SEs.
se_skip_if_aws "full-zmq bring-up stops LocalStack mid-suite (Lambda wipe) — run under BUS_PROFILE=zmq only"
[ -f "$ENV_FILE" ] || se_skip "no .env at repo root — cannot safely flip orchestrator env without one"
[ -f "$COMPOSE_ZMQ" ] || se_skip "no docker-compose.zmq.yml at repo root — the zmq profiles are missing"
# Retry-poll (loaded hosts boot the orchestrator slowly after recreate-heavy SEs)
se_wait_orchestrator_health 90 2 \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
docker compose version >/dev/null 2>&1 || se_skip "docker compose CLI not available"
docker image inspect dtm-zmq-worker-host:latest >/dev/null 2>&1 \
  || se_skip "dtm-zmq-worker-host:latest missing — build it: docker compose -f docker-compose.zmq.yml build zmq-worker-host-order-processing"

# --- arrange: snapshot .env + running broker containers ----------------------
ENV_BACKUP="$(mktemp)"
cp "$ENV_FILE" "$ENV_BACKUP"

RUNNING_BROKERS="$(docker ps -q $(for c in $BROKER_CONTAINERS; do echo --filter "name=^${c}$"; done) || true)"
RUNNING_POLLERS="$(docker ps -q --filter "name=${PROJECT}-sqs-poller" || true)"

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


# Restore the worker fleet when the OUTER stack profile needs it (see SE-31's
# copy of this comment): under a restored zmq .env a bare rm -sf would leave
# subsequent evals workerless.
restore_workers_if_profile_needs() {
  grep -qE '^BUS_PROFILE=zmq|^QUEUE_TRANSPORT=zmq' "$ENV_FILE" || return 0
  zmq_compose up -d \
    zmq-worker-host-order-processing \
    zmq-worker-host-iot-sensor-pipeline \
    zmq-worker-host-infra-provisioning >/dev/null 2>&1 || true
}
restore_all() {
  # Brokers first (nothing asserts during restore — best effort, never mask the verdict).
  # ORDER MATTERS: kafka crashes when started before zookeeper is ready, and an aws
  # boot wedges in kafkajs consumer connect when kafka is absent — so bring
  # zookeeper up first, wait for kafka healthy, and only then recreate.
  if [ -n "$RUNNING_BROKERS" ]; then
    # shellcheck disable=SC2086
    docker start $RUNNING_BROKERS >/dev/null 2>&1 || true
    # kafka routinely exits(1) when its first start lands before zookeeper is
    # ready — RETRY the start, don't just wait (observed live, twice).
    local ktries=0
    until [ "$(docker inspect -f '{{.State.Health.Status}}' "${PROJECT}-kafka" 2>/dev/null)" = "healthy" ]; do
      ktries=$((ktries + 1))
      [ "$ktries" -gt 30 ] && break
      [ "$(docker inspect -f '{{.State.Status}}' "${PROJECT}-kafka" 2>/dev/null)" = "exited" ]         && docker start "${PROJECT}-kafka" >/dev/null 2>&1 || true
      sleep 2
    done
  fi
  # shellcheck disable=SC2086
  [ -n "$RUNNING_POLLERS" ] && docker start $RUNNING_POLLERS >/dev/null 2>&1 || true
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

# --- arrange: BUS_PROFILE=zmq umbrella ONLY (no explicit per-var env) ---------
sed -i '/^BUS_PROFILE=/d;/^QUEUE_TRANSPORT=/d;/^EVENT_BUS=/d' "$ENV_FILE"
printf '\nBUS_PROFILE=zmq\n' >> "$ENV_FILE"

# Stop every broker container + any sqs-pollers — the zero-broker assertion
# shellcheck disable=SC2086
[ -n "$RUNNING_BROKERS" ] && docker stop $RUNNING_BROKERS >/dev/null || true
# shellcheck disable=SC2086
[ -n "$RUNNING_POLLERS" ] && docker stop $RUNNING_POLLERS >/dev/null || true

zmq_compose up -d --no-deps --force-recreate orchestrator dev-ack-simulator
wait_for_orchestrator_health \
  || { log_fail "orchestrator did not come back healthy under BUS_PROFILE=zmq with brokers down"; exit 1; }

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
sleep 5 # simulator SUB slow-joiner settle

ORCH_LOGS="$(docker logs "${PROJECT}-orchestrator" 2>&1 | tail -300)"

BROKERS_LEFT="$(docker ps -q $(for c in $BROKER_CONTAINERS; do echo --filter "name=^${c}$"; done) | wc -l | tr -d ' ')"
POLLERS_LEFT="$(docker ps -q --filter "name=${PROJECT}-sqs-poller" | wc -l | tr -d ' ')"

READY_CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 15 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health/ready")"
# Retry until the kafka key is present — a preceding SE's trap recreate can be
# mid-boot when this probe first fires (observed live as a false 'missing').
READY_BODY=""
for _ in 1 2 3 4 5; do
  READY_BODY="$(curl -s -m 15 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health/ready")"
  echo "$READY_BODY" | jq -e '.info.kafka.status' >/dev/null 2>&1 && break
  sleep 3
done
READY_KAFKA="$(echo "$READY_BODY" | jq -r '.info.kafka.status // .details.kafka.status // "missing"' 2>/dev/null)"
TOPICS_JSON=""
for _ in 1 2 3; do
  TOPICS_JSON="$(curl -s -m 20 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/kafka/topics")"
  echo "$TOPICS_JSON" | jq -e '.connected' >/dev/null 2>&1 && break
  sleep 3
done
# NOTE: jq's // alternative treats false as empty (false // "missing" → "missing")
# — use tostring, which renders booleans faithfully.
TOPICS_CONNECTED="$(echo "$TOPICS_JSON" | jq -r '.connected | tostring' 2>/dev/null)"
TOPICS_COUNT="$(echo "$TOPICS_JSON" | jq -r '.topics | length' 2>/dev/null || echo -1)"

# --- act: quick-order end-to-end with zero brokers ---------------------------
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

# --- assert (1:1 with the README checkbox list) --------------------------------
ck_eq "zero broker containers running (kafka, zookeeper, kafka-ui, localstack)" "$BROKERS_LEFT" "0"
ck_eq "zero sqs-poller containers running" "$POLLERS_LEFT" "0"
ck_has "the umbrella expanded with NO explicit per-var env (ROUTER bound)" "$ORCH_LOGS" "ZmqTransport ROUTER bound"
ck_has "the umbrella expanded with NO explicit per-var env (event bus bound)" "$ORCH_LOGS" "ZmqEventBus bound"
ck "the zmq worker fleet is alive on a broker-less network" test "${ALIVE:-0}" -ge 3
ck_eq "readiness stays 200 with Kafka down (graceful degradation)" "$READY_CODE" "200"
ck_eq "readiness reports Kafka honestly as down (no fabricated 'up')" "$READY_KAFKA" "down"
ck_eq "kafka topics endpoint degrades honestly (connected: false)" "$TOPICS_CONNECTED" "false"
ck_eq "kafka topics endpoint fabricates no topics" "$TOPICS_COUNT" "0"
ck_eq "the quick-order job completed on a single docker network with zero brokers" "${JOB_FINAL,,}" "completed"

se_summary
