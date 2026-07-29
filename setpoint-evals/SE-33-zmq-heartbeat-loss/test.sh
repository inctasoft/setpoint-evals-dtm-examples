#!/usr/bin/env bash
# SE-33: zmq heartbeat loss — mixed mode up; an infra-provisioning worker-host
# is docker-killed; the worker registry marks it dead within the configured
# silence window (ZMQ_WORKER_SILENCE_MS, swept on ZMQ_WORKER_SWEEP_INTERVAL_MS);
# after the container restarts, a HELLO (re-)registers an infra-provisioning
# worker as alive. Restores .env, orchestrator, and worker hosts afterward no
# matter what (EXIT trap).
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

log_info "SE-33: zmq heartbeat loss — registry marks a silent worker dead, HELLO revives it"

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
docker image inspect dtm-zmq-worker-host:latest >/dev/null 2>&1 \
  || se_skip "dtm-zmq-worker-host:latest missing — build it: docker compose -f docker-compose.zmq.yml build zmq-worker-host-order-processing"

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

# --- arrange: zmq transport with a tight silence window ----------------------
sed -i '/^QUEUE_TRANSPORT=/d;/^ZMQ_WORKER_SILENCE_MS=/d;/^ZMQ_WORKER_SWEEP_INTERVAL_MS=/d' "$ENV_FILE"
printf '\nQUEUE_TRANSPORT=zmq\nZMQ_WORKER_SILENCE_MS=5000\nZMQ_WORKER_SWEEP_INTERVAL_MS=1000\n' >> "$ENV_FILE"

zmq_compose up -d --no-deps --force-recreate orchestrator
wait_for_orchestrator_health \
  || { log_fail "orchestrator did not come back healthy under QUEUE_TRANSPORT=zmq"; exit 1; }

zmq_compose up -d \
  zmq-worker-host-order-processing \
  zmq-worker-host-iot-sensor-pipeline \
  zmq-worker-host-infra-provisioning

# Wait for the infra-provisioning worker to HELLO-register, and remember its id
TARGET_WORKER_ID=""
for _ in $(seq 1 30); do
  WORKERS_JSON="$(curl -s -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workers")"
  TARGET_WORKER_ID="$(echo "$WORKERS_JSON" | jq -r '[.[] | select(.state == "alive") | select(.workerId | startswith("infra-provisioning"))][0].workerId // empty' 2>/dev/null)"
  [ -n "$TARGET_WORKER_ID" ] && break
  sleep 2
done
[ -n "$TARGET_WORKER_ID" ] || { log_fail "no infra-provisioning worker registered"; exit 1; }

# --- act: silence the worker --------------------------------------------------
CID="$(docker ps -q --filter "name=${PROJECT}-zmq-worker-host-infra-provisioning" | head -1)"
[ -n "$CID" ] || { log_fail "no infra-provisioning worker-host container running"; exit 1; }
docker kill "$CID" >/dev/null

# The registry must mark the worker dead within silence + sweep + slack (20s)
DEAD_SEEN="no"
for _ in $(seq 1 20); do
  STATE="$(curl -s -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workers" \
    | jq -r --arg id "$TARGET_WORKER_ID" '.[] | select(.workerId == $id) | .state // empty' 2>/dev/null)"
  [ "$STATE" = "dead" ] && { DEAD_SEEN="yes"; break; }
  sleep 1
done

# --- act: the worker returns --------------------------------------------------
# (restart: unless-stopped may already have revived the container; start is idempotent)
docker start "$CID" >/dev/null 2>&1 || true

ALIVE_AGAIN="no"
for _ in $(seq 1 45); do
  ALIVE_COUNT="$(curl -s -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workers" \
    | jq '[.[] | select(.state == "alive") | select(.workerId | startswith("infra-provisioning"))] | length' 2>/dev/null || echo 0)"
  [ "${ALIVE_COUNT:-0}" -ge 1 ] && { ALIVE_AGAIN="yes"; break; }
  sleep 2
done

ORCH_LOGS="$(docker logs "${PROJECT}-orchestrator" 2>&1 | tail -400)"

# --- assert (1:1 with the README checkbox list) --------------------------------
ck_has "the orchestrator booted the ZeroMQ ROUTER transport" "$ORCH_LOGS" "ZmqTransport ROUTER bound"
ck "the target worker was registered alive before the kill" test -n "$TARGET_WORKER_ID"
ck_eq "the registry marked the silent worker dead within the silence window" "$DEAD_SEEN" "yes"
ck_has "the orchestrator logged the worker loss" "$ORCH_LOGS" "Worker lost"
ck_eq "an infra-provisioning worker HELLO-(re-)registered after the restart" "$ALIVE_AGAIN" "yes"
ck_has "the orchestrator logged a registration after the loss" "$ORCH_LOGS" "registered"

se_summary
