#!/usr/bin/env bash
# SE-25: GET /api/v1/jobs/:jobId/steps/:stepName/activity — the per-step drill-down
# contract (capability-spec.md §3.2a, dtm-video-v2 Lane A). Reads REAL retry/ACK/
# fan-out data already sitting in dtm_steps from prior SE runs on the live dev stack
# instead of re-seeding a ~90-130s retry timeline — this SE pins the ENDPOINT's shape,
# not the retry/ACK/fan-out mechanics themselves (SE-01/SE-02/SE-04/double-fan-out own
# those). Loudly SKIPs (never fake-greens) if the dev stack has no such row yet.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq (pipefail-safe, mutate counters — never call in $()), se_skip, se_summary.
# NOTE: flat under setpoint-evals/ (SE-01..SE-24 convention); se-lib.sh is 2 levels up.
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-25: GET jobs/:jobId/steps/:stepName/activity — activity endpoint contract"

# --- preflight ---------------------------------------------------------------
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
command -v jq >/dev/null 2>&1 || se_skip "jq is required"
DB_CONTAINER="${COMPOSE_PROJECT_NAME:-dtm}-db"
docker exec "$DB_CONTAINER" true >/dev/null 2>&1 \
  || se_skip "DB container ${DB_CONTAINER} not reachable (docker exec failed)"

API="${ORCHESTRATOR_HOST}/api/${API_VERSION}"
psql_q() { docker exec "$DB_CONTAINER" psql -U dtm_user -d dtm -t -A -F'|' -c "$1" 2>/dev/null; }

# ═══════════════════════════════════════════════════════════════════════════
# 1. Retry attempts — a real 3x-failed step, if one exists on the dev stack
# ═══════════════════════════════════════════════════════════════════════════
RETRY_ROW=$(psql_q "SELECT job_id, step_value FROM dtm_steps WHERE retry_count >= 3 AND parent_step_id IS NULL ORDER BY started_at DESC LIMIT 1;")
if [ -z "$RETRY_ROW" ]; then
  se_skip "no step with retry_count>=3 exists in dtm_steps — run SE-01-retry-transient-failure or SE-02-dlq-permanent-failure first, then re-run this SE"
fi
RETRY_JOB_ID="${RETRY_ROW%%|*}"
RETRY_STEP="${RETRY_ROW##*|}"
log_info "1. retry scenario: job=${RETRY_JOB_ID} step=${RETRY_STEP}"

DB_ATTEMPT_COUNT=$(psql_q "SELECT jsonb_array_length(execution_history) FROM dtm_steps WHERE job_id='${RETRY_JOB_ID}' AND step_value='${RETRY_STEP}';")
DB_HISTORY_NORM=$(psql_q "SELECT execution_history::text FROM dtm_steps WHERE job_id='${RETRY_JOB_ID}' AND step_value='${RETRY_STEP}';" | jq -c '.' 2>/dev/null)

RESP=$(curl -s -w '\n%{http_code}' -m 15 "${API}/jobs/${RETRY_JOB_ID}/steps/${RETRY_STEP}/activity")
HTTP=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')

ck_eq "1. GET .../activity returns HTTP 200 for a retried step" "$HTTP" "200"
API_ATTEMPT_COUNT=$(echo "$BODY" | jq '.attempts | length' 2>/dev/null)
ck_eq "1. attempts[] length matches jsonb_array_length(execution_history)=${DB_ATTEMPT_COUNT}" "$API_ATTEMPT_COUNT" "$DB_ATTEMPT_COUNT"

MONOTONIC=$(echo "$BODY" | jq '([.attempts[].attemptNumber]) as $a | ($a == ($a | sort)) and (($a | unique | length) == ($a | length)) and ($a | length) > 0' 2>/dev/null || echo false)
ck_eq "1. attempt numbers are monotonically increasing with no duplicates" "$MONOTONIC" "true"

API_HISTORY_NORM=$(echo "$BODY" | jq -c '.attempts' 2>/dev/null)
ck_eq "1. attempts[] matches dtm_steps.execution_history byte-for-byte (jq-normalized)" "$API_HISTORY_NORM" "$DB_HISTORY_NORM"

# ═══════════════════════════════════════════════════════════════════════════
# 2. ACK wait — a real ACK-bearing step, if one exists
# ═══════════════════════════════════════════════════════════════════════════
ACK_ROW=$(psql_q "SELECT job_id, step_value FROM dtm_steps WHERE kafka_published_at IS NOT NULL AND ack_received_at IS NOT NULL AND parent_step_id IS NULL ORDER BY started_at DESC LIMIT 1;")
if [ -z "$ACK_ROW" ]; then
  se_skip "no ACK-bearing step exists in dtm_steps — run an order-processing job (SubmitCustomer/SubmitOrder ACK) first, then re-run this SE"
fi
ACK_JOB_ID="${ACK_ROW%%|*}"
ACK_STEP="${ACK_ROW##*|}"
log_info "2. ack scenario: job=${ACK_JOB_ID} step=${ACK_STEP}"

DB_ACK_WAIT_MS=$(psql_q "SELECT ROUND(EXTRACT(EPOCH FROM (ack_received_at - kafka_published_at)) * 1000) FROM dtm_steps WHERE job_id='${ACK_JOB_ID}' AND step_value='${ACK_STEP}';")

RESP2=$(curl -s -m 15 "${API}/jobs/${ACK_JOB_ID}/steps/${ACK_STEP}/activity")
API_ACK_WAIT_MS=$(echo "$RESP2" | jq '.ack.ackWaitMs' 2>/dev/null)
API_ACK_META_NONNULL=$(echo "$RESP2" | jq '.ack.ackMetadata != null' 2>/dev/null || echo false)

ACK_WITHIN_TOLERANCE=$(jq -n --argjson api "${API_ACK_WAIT_MS:-null}" --argjson db "${DB_ACK_WAIT_MS:-null}" \
  '(($api != null) and ($db != null)) and (((($api - $db) | if . < 0 then -. else . end)) <= 5)' 2>/dev/null || echo false)
ck_eq "2. ack.ackWaitMs == ack_received_at - kafka_published_at (±5ms; api=${API_ACK_WAIT_MS} db=${DB_ACK_WAIT_MS})" "$ACK_WITHIN_TOLERANCE" "true"
ck_eq "2. ack.ackMetadata is non-null" "$API_ACK_META_NONNULL" "true"

# ═══════════════════════════════════════════════════════════════════════════
# 3. Fan-out parent — a real discovery/parent step with children, if one exists
# ═══════════════════════════════════════════════════════════════════════════
FANOUT_ROW=$(psql_q "SELECT job_id, step_value, child_count FROM dtm_steps WHERE child_count IS NOT NULL AND child_count > 0 AND parent_step_id IS NULL ORDER BY started_at DESC LIMIT 1;")
if [ -z "$FANOUT_ROW" ]; then
  se_skip "no fan-out parent step (child_count>0) exists in dtm_steps — run workflows/iot-sensor-pipeline/setpoint-evals/SE-03-double-fan-out or an order-processing job with line items first, then re-run this SE"
fi
FO_JOB_ID=$(echo "$FANOUT_ROW" | cut -d'|' -f1)
FO_STEP=$(echo "$FANOUT_ROW" | cut -d'|' -f2)
FO_CHILD_COUNT=$(echo "$FANOUT_ROW" | cut -d'|' -f3)
log_info "3. fan-out scenario: job=${FO_JOB_ID} step=${FO_STEP} child_count=${FO_CHILD_COUNT}"

FO_STEP_ID=$(psql_q "SELECT id FROM dtm_steps WHERE job_id='${FO_JOB_ID}' AND step_value='${FO_STEP}' AND parent_step_id IS NULL;")
DB_CHILD_ROWS=$(psql_q "SELECT count(*) FROM dtm_steps WHERE parent_step_id='${FO_STEP_ID}';")

RESP3=$(curl -s -m 15 "${API}/jobs/${FO_JOB_ID}/steps/${FO_STEP}/activity")
API_CHILD_COUNT=$(echo "$RESP3" | jq '.fanOut.childCount' 2>/dev/null)
API_CHILDREN_LEN=$(echo "$RESP3" | jq '.fanOut.children | length' 2>/dev/null)
API_CHILDREN_HAVE_FIELDS=$(echo "$RESP3" | jq '(.fanOut.children // []) as $c | ([$c[] | select(has("childIndex") and has("childItemId") and has("status"))] | length) == ($c | length) and ($c | length) > 0' 2>/dev/null || echo false)

ck_eq "3. fanOut.childCount matches DB child_count (${FO_CHILD_COUNT})" "$API_CHILD_COUNT" "$FO_CHILD_COUNT"
ck_eq "3. fanOut.children length matches real DB child rows (${DB_CHILD_ROWS})" "$API_CHILDREN_LEN" "$DB_CHILD_ROWS"
ck_eq "3. every fanOut.children[] entry carries childIndex/childItemId/status" "$API_CHILDREN_HAVE_FIELDS" "true"

# ═══════════════════════════════════════════════════════════════════════════
# 4. 404 semantics — never 500, never empty-200
# ═══════════════════════════════════════════════════════════════════════════
UNKNOWN_JOB_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${API}/jobs/00000000-0000-0000-0000-000000000000/steps/AnyStep/activity")
ck_eq "4. unknown jobId returns 404 (never 500, never empty-200)" "$UNKNOWN_JOB_HTTP" "404"

UNKNOWN_STEP_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${API}/jobs/${RETRY_JOB_ID}/steps/DoesNotExistStep/activity")
ck_eq "4. unknown stepName on a real job returns 404 (never 500, never empty-200)" "$UNKNOWN_STEP_HTTP" "404"

se_summary
