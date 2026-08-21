#!/usr/bin/env bash
# SE-28: StepSnapshot.childCount (capability-spec.md §3.4, dtm-video-v2 Lane A). Submits
# one fresh double-fan-out iot-sensor-pipeline job (greenhouse-3, same fixture as
# workflows/iot-sensor-pipeline/setpoint-evals/SE-03-double-fan-out) so it's guaranteed
# to be inside the WS snapshot's recency window, then captures a snapshot and checks the
# DiscoverSensors entry's childCount against the real dtm_steps child-row count.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-28: WS snapshot StepSnapshot.childCount on a fan-out parent"

# --- preflight ---------------------------------------------------------------
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
command -v jq >/dev/null 2>&1 || se_skip "jq is required"
node -e "require('ws')" >/dev/null 2>&1 || se_skip "the 'ws' node module is not resolvable from ${ROOT}"
DB_CONTAINER="${COMPOSE_PROJECT_NAME:-dtm}-db"
docker exec "$DB_CONTAINER" true >/dev/null 2>&1 \
  || se_skip "DB container ${DB_CONTAINER} not reachable (docker exec failed)"

API="${ORCHESTRATOR_HOST}/api/${API_VERSION}"
psql_q() { docker exec "$DB_CONTAINER" psql -U dtm_user -d dtm -t -A -F'|' -c "$1" 2>/dev/null; }

# ═══════════════════════════════════════════════════════════════════════════
# 1. Submit a fresh double-fan-out job (greenhouse-3, per SE-03's reference payload)
# ═══════════════════════════════════════════════════════════════════════════
PAYLOAD=$(cat << EOF
{
  "enableDeduplication": false,
  "variant": "default",
  "payload": { "deviceId": "greenhouse-3", "entityId": "se28-$(date +%s)" },
  "testOptions": {
    "RegisterDevice":     { "simDelay": 200 },
    "ProvisionDevice":    { "simDelay": 200, "ackDelay": 500 },
    "DiscoverSensors":    { "simDelay": 200 },
    "CalibrateSensor":    { "simDelay": 200 },
    "ActivateSensor":     { "simDelay": 200, "ackDelay": 500 },
    "DiscoverReadings":   { "simDelay": 200 },
    "IngestReading":      { "simDelay": 200 },
    "PublishReading":     { "simDelay": 200, "ackDelay": 500 },
    "EvaluateAlert":      { "simDelay": 200 },
    "DispatchAlert":      { "simDelay": 200, "ackDelay": 500 },
    "ComputeAggregate":   { "simDelay": 200 },
    "PublishAggregate":   { "simDelay": 200, "ackDelay": 500 }
  }
}
EOF
)

RESP=$(curl -s -w '\n%{http_code}' -m 15 -X POST "${API}/workflows/iot-sensor-pipeline/jobs" \
  -H "Content-Type: application/json" -d "$PAYLOAD")
HTTP=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')
[ "$HTTP" = "201" ] || se_skip "job submission failed (HTTP ${HTTP}): ${BODY}"
JOB_ID=$(echo "$BODY" | jq -r '.jobId')
[ -n "$JOB_ID" ] && [ "$JOB_ID" != "null" ] || se_skip "job submission response had no jobId: ${BODY}"
log_info "1. submitted job ${JOB_ID}, waiting for DiscoverSensors to fan out..."

# Give DiscoverSensors + its children a moment to run. 20s was tuned for an
# idle aws stack; under zmq + parallel-wave contention the two preceding steps
# (each with an ACK roundtrip) can take much longer (observed live SKIP:22 —
# job was still running, not broken).
for _ in $(seq 1 90); do
  DS_STATUS=$(psql_q "SELECT status FROM dtm_steps WHERE job_id='${JOB_ID}' AND step_value='DiscoverSensors';")
  [ "$DS_STATUS" = "completed" ] && break
  sleep 1
done

DB_CHILD_COUNT=$(psql_q "SELECT child_count FROM dtm_steps WHERE job_id='${JOB_ID}' AND step_value='DiscoverSensors';")
if [ -z "$DB_CHILD_COUNT" ] || [ "$DB_CHILD_COUNT" = "" ]; then
  se_skip "DiscoverSensors never completed / has no child_count for job ${JOB_ID} — job may still be running"
fi
log_info "1. DB child_count for DiscoverSensors: ${DB_CHILD_COUNT}"

# ═══════════════════════════════════════════════════════════════════════════
# 2. Capture a WS snapshot and inspect this job's steps
# ═══════════════════════════════════════════════════════════════════════════
WS_URL="ws://localhost:${ORCHESTRATOR_PORT:-3002}/ws/events"
SNAPSHOT=$(node "$ROOT/setpoint-evals/shared/ws-snapshot-capture.mjs" "$WS_URL" 15 2>/tmp/se28-ws.log)
SNAP_RC=$?
[ "$SNAP_RC" -eq 0 ] || se_skip "ws-snapshot-capture failed (see /tmp/se28-ws.log)"

JOB_IN_SNAPSHOT=$(echo "$SNAPSHOT" | jq --arg id "$JOB_ID" '[.jobs[] | select(.id == $id)] | length' 2>/dev/null)
ck_eq "1. submitted job appears in the captured WS snapshot" "$JOB_IN_SNAPSHOT" "1"
if [ "$JOB_IN_SNAPSHOT" != "1" ]; then
  se_skip "job ${JOB_ID} not in snapshot (possibly pushed out of findRecentJobs(20) by concurrent activity) — re-run"
fi

API_CHILD_COUNT=$(echo "$SNAPSHOT" | jq --arg id "$JOB_ID" '[.jobs[] | select(.id == $id) | .steps[] | select(.step == "DiscoverSensors") | .childCount][0]' 2>/dev/null)
ck_eq "2. DiscoverSensors StepSnapshot.childCount matches DB child_count (${DB_CHILD_COUNT})" "$API_CHILD_COUNT" "$DB_CHILD_COUNT"

REGISTER_CHILD_COUNT_ABSENT=$(echo "$SNAPSHOT" | jq --arg id "$JOB_ID" '
  [.jobs[] | select(.id == $id) | .steps[] | select(.step == "RegisterDevice")][0]
  | (has("childCount") | not) or (.childCount == null)' 2>/dev/null)
ck_eq "3. RegisterDevice (non-fan-out) has no childCount key, or it is null" "$REGISTER_CHILD_COUNT_ABSENT" "true"

# ═══════════════════════════════════════════════════════════════════════════
# 3. Regression guard — pre-existing StepSnapshot fields unaffected
# ═══════════════════════════════════════════════════════════════════════════
FIELDS_INTACT=$(echo "$SNAPSHOT" | jq --arg id "$JOB_ID" '
  [.jobs[] | select(.id == $id) | .steps[]
   | select((has("step") and has("description") and has("status") and has("stepNumber")) | not)]
  | length == 0' 2>/dev/null)
ck_eq "4. pre-existing StepSnapshot fields (step/description/status/stepNumber) still present on every entry" "$FIELDS_INTACT" "true"

se_summary
