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
# NOTE: the correct DB baseline for fanOut.children is one row per DISTINCT
# childItemId under this parent — NOT the raw row count. A fan-out parent whose
# childStepChain has length > 1 (e.g. order-processing's DiscoverLineItems ->
# [ValidateLineItem, SubmitLineItem], or iot-sensor-pipeline's DiscoverSensors ->
# [CalibrateSensor, ActivateSensor, DiscoverReadings, ComputeAggregate,
# PublishAggregate]) has MULTIPLE dtm_steps rows sharing one parent_step_id per
# item — one per chain step — so raw COUNT(*) over-counts by the chain length.
# Scenario 3b below pins this distinction explicitly with a deterministic
# chained-fanout example (was previously asserted against raw row count here,
# which silently encoded the badge-scope bug as "correct").
DB_DISTINCT_ITEMS=$(psql_q "SELECT count(DISTINCT child_item_id) FROM dtm_steps WHERE parent_step_id='${FO_STEP_ID}';")

RESP3=$(curl -s -m 15 "${API}/jobs/${FO_JOB_ID}/steps/${FO_STEP}/activity")
API_CHILD_COUNT=$(echo "$RESP3" | jq '.fanOut.childCount' 2>/dev/null)
API_CHILDREN_LEN=$(echo "$RESP3" | jq '.fanOut.children | length' 2>/dev/null)
API_CHILDREN_HAVE_FIELDS=$(echo "$RESP3" | jq '(.fanOut.children // []) as $c | ([$c[] | select(has("childIndex") and has("childItemId") and has("status"))] | length) == ($c | length) and ($c | length) > 0' 2>/dev/null || echo false)
API_CHILDREN_UNIQUE_ITEMS=$(echo "$RESP3" | jq '(.fanOut.children // []) as $c | (($c | map(.childItemId) | unique | length) == ($c | length))' 2>/dev/null || echo false)

ck_eq "3. fanOut.childCount matches DB child_count (${FO_CHILD_COUNT})" "$API_CHILD_COUNT" "$FO_CHILD_COUNT"
ck_eq "3. fanOut.children length matches distinct childItemId count under this parent (${DB_DISTINCT_ITEMS}), not the raw chain-row count" "$API_CHILDREN_LEN" "$DB_DISTINCT_ITEMS"
ck_eq "3. every fanOut.children[] entry carries childIndex/childItemId/status" "$API_CHILDREN_HAVE_FIELDS" "true"
ck_eq "3. fanOut.children[] has no duplicate childItemId (one row per immediate fan-out item)" "$API_CHILDREN_UNIQUE_ITEMS" "true"

# ═══════════════════════════════════════════════════════════════════════════
# 3b. Chained fan-out parent (childStepChain length > 1) — the badge-scope bug
#     class. GIVEN a discovery/parent step whose children span MORE THAN ONE
#     distinct step_value (proof it has a multi-step childStepChain, e.g.
#     iot-sensor-pipeline's DiscoverSensors -> [CalibrateSensor, ActivateSensor,
#     DiscoverReadings, ComputeAggregate, PublishAggregate]) THEN
#     fanOut.childCount/children must still equal the DECLARED child count (one
#     per fan-out item), never the raw chain-step row count. Prefers
#     DiscoverSensors (the concrete case that motivated this fix — reported live
#     as a "18/3" DAG badge) but falls back to any qualifying chained parent so
#     this never SKIPs on a stack that only ran order-processing.
# ═══════════════════════════════════════════════════════════════════════════
CHAINED_ROW=$(psql_q "
  SELECT p.job_id, p.step_value, p.child_count
  FROM dtm_steps p
  WHERE p.parent_step_id IS NULL
    AND p.child_count IS NOT NULL AND p.child_count > 0
    AND (SELECT count(DISTINCT c.step_value) FROM dtm_steps c WHERE c.parent_step_id = p.id) > 1
  ORDER BY (p.step_value = 'DiscoverSensors') DESC, p.started_at DESC
  LIMIT 1;
")
if [ -z "$CHAINED_ROW" ]; then
  se_skip "no chained fan-out parent step (>1 distinct child step_value sharing one parent_step_id) exists in dtm_steps — run workflows/iot-sensor-pipeline/setpoint-evals/SE-03-double-fan-out first, then re-run this SE"
fi
CH_JOB_ID=$(echo "$CHAINED_ROW" | cut -d'|' -f1)
CH_STEP=$(echo "$CHAINED_ROW" | cut -d'|' -f2)
CH_CHILD_COUNT=$(echo "$CHAINED_ROW" | cut -d'|' -f3)
log_info "3b. chained fan-out scenario: job=${CH_JOB_ID} step=${CH_STEP} child_count=${CH_CHILD_COUNT}"

CH_STEP_ID=$(psql_q "SELECT id FROM dtm_steps WHERE job_id='${CH_JOB_ID}' AND step_value='${CH_STEP}' AND parent_step_id IS NULL;")
CH_RAW_ROWS=$(psql_q "SELECT count(*) FROM dtm_steps WHERE parent_step_id='${CH_STEP_ID}';")
CH_CHAIN_STEP_VALUES_JSON=$(psql_q "SELECT jsonb_agg(DISTINCT step_value)::text FROM dtm_steps WHERE parent_step_id='${CH_STEP_ID}';")

RESP3B=$(curl -s -m 15 "${API}/jobs/${CH_JOB_ID}/steps/${CH_STEP}/activity")
API_CH_CHILD_COUNT=$(echo "$RESP3B" | jq '.fanOut.childCount' 2>/dev/null)
API_CH_CHILDREN_LEN=$(echo "$RESP3B" | jq '.fanOut.children | length' 2>/dev/null)
API_CH_CHILDREN_UNIQUE_ITEMS=$(echo "$RESP3B" | jq '(.fanOut.children // []) as $c | (($c | map(.childItemId) | unique | length) == ($c | length))' 2>/dev/null || echo false)
API_CH_NO_NESTED_LEAK=$(echo "$RESP3B" | jq --argjson allowed "$CH_CHAIN_STEP_VALUES_JSON" \
  '(.fanOut.children // []) as $c | ([$c[] | select(.step as $s | ($allowed // []) | index($s) | not)] | length) == 0' 2>/dev/null || echo false)

ck "3b. sanity: this parent's raw child-row count (${CH_RAW_ROWS}) exceeds its declared childCount (${CH_CHILD_COUNT}) — confirms it IS a chained fan-out, not a false-positive scenario pick" \
  test "$CH_RAW_ROWS" -gt "$CH_CHILD_COUNT"
ck_eq "3b. fanOut.childCount equals the declared child_count (${CH_CHILD_COUNT}), not the raw chain-row count (${CH_RAW_ROWS})" "$API_CH_CHILD_COUNT" "$CH_CHILD_COUNT"
ck_eq "3b. fanOut.children length equals the declared childCount (${CH_CHILD_COUNT}), not the raw chain-row count (${CH_RAW_ROWS}) — the badge-scope bug under test" "$API_CH_CHILDREN_LEN" "$CH_CHILD_COUNT"
ck_eq "3b. fanOut.children[] has no duplicate childItemId (one row per immediate fan-out item, not one per chain step)" "$API_CH_CHILDREN_UNIQUE_ITEMS" "true"
ck_eq "3b. every fanOut.children[].step is one of this parent's own childStepChain types (no nested-descendant leakage from a deeper fan-out level)" "$API_CH_NO_NESTED_LEAK" "true"

# ═══════════════════════════════════════════════════════════════════════════
# 4. 404 semantics — never 500, never empty-200
# ═══════════════════════════════════════════════════════════════════════════
UNKNOWN_JOB_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${API}/jobs/00000000-0000-0000-0000-000000000000/steps/AnyStep/activity")
ck_eq "4. unknown jobId returns 404 (never 500, never empty-200)" "$UNKNOWN_JOB_HTTP" "404"

UNKNOWN_STEP_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${API}/jobs/${RETRY_JOB_ID}/steps/DoesNotExistStep/activity")
ck_eq "4. unknown stepName on a real job returns 404 (never 500, never empty-200)" "$UNKNOWN_STEP_HTTP" "404"

# ═══════════════════════════════════════════════════════════════════════════
# 5. Fan-out-CHILD-ONLY step — a step name that exists ONLY as fan-out children,
#    with NO primary (parent_step_id IS NULL) row at all. iot-sensor-pipeline's
#    double fan-out is the canonical case: DiscoverReadings and IngestReading are
#    themselves entirely children (of DiscoverSensors and of a DiscoverReadings
#    instance respectively) — every row for that step_value has a parent. Prior to
#    this SE case, the endpoint 404'd here; it must now return an instance-aggregate
#    (200, `aggregate: true`) instead. Prefers DiscoverReadings when present (the
#    concrete case that motivated this fix) but falls back to any qualifying
#    fan-out-child-only step name so the scenario never SKIPs on an unrelated stack.
# ═══════════════════════════════════════════════════════════════════════════
FOCHILD_ROW=$(psql_q "
  SELECT s.job_id, s.step_value
  FROM dtm_steps s
  WHERE s.parent_step_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM dtm_steps p
    WHERE p.job_id = s.job_id AND p.step_value = s.step_value AND p.parent_step_id IS NULL
  )
  GROUP BY s.job_id, s.step_value
  ORDER BY (s.step_value = 'DiscoverReadings') DESC, s.job_id DESC
  LIMIT 1;
")
if [ -z "$FOCHILD_ROW" ]; then
  se_skip "no fan-out-child-only step (a step_value with ONLY parent_step_id IS NOT NULL rows) exists in dtm_steps — run workflows/iot-sensor-pipeline/setpoint-evals/SE-03-double-fan-out first, then re-run this SE"
fi
FOCHILD_JOB_ID="${FOCHILD_ROW%%|*}"
FOCHILD_STEP="${FOCHILD_ROW##*|}"
log_info "5. fan-out-child-only scenario: job=${FOCHILD_JOB_ID} step=${FOCHILD_STEP}"

DB_INSTANCE_COUNT=$(psql_q "SELECT count(*) FROM dtm_steps WHERE job_id='${FOCHILD_JOB_ID}' AND step_value='${FOCHILD_STEP}' AND parent_step_id IS NOT NULL;")
DB_PAIRS_JSON=$(psql_q "
  SELECT jsonb_agg(jsonb_build_array(t.child_index, t.child_item_id, t.parent_step_value) ORDER BY t.child_index, t.child_item_id, t.parent_step_value)::text
  FROM (
    SELECT c.child_index, c.child_item_id, p.step_value AS parent_step_value
    FROM dtm_steps c
    LEFT JOIN dtm_steps p ON p.id = c.parent_step_id
    WHERE c.job_id='${FOCHILD_JOB_ID}' AND c.step_value='${FOCHILD_STEP}' AND c.parent_step_id IS NOT NULL
  ) t;
")

RESP5=$(curl -s -w '\n%{http_code}' -m 15 "${API}/jobs/${FOCHILD_JOB_ID}/steps/${FOCHILD_STEP}/activity")
HTTP5=$(echo "$RESP5" | tail -n1)
BODY5=$(echo "$RESP5" | sed '$d')

ck_eq "5. fan-out-child-only step returns HTTP 200 (not 404 — the fix under test)" "$HTTP5" "200"
API_AGGREGATE_FLAG=$(echo "$BODY5" | jq '.aggregate' 2>/dev/null)
ck_eq "5. response has aggregate:true" "$API_AGGREGATE_FLAG" "true"
API_INSTANCE_COUNT=$(echo "$BODY5" | jq '.instanceCount' 2>/dev/null)
ck_eq "5. instanceCount matches real DB child-row count (${DB_INSTANCE_COUNT})" "$API_INSTANCE_COUNT" "$DB_INSTANCE_COUNT"

API_DIST_SUM=$(echo "$BODY5" | jq '[.statusDistribution[]?] | add' 2>/dev/null)
ck_eq "5. statusDistribution values sum to instanceCount" "$API_DIST_SUM" "$DB_INSTANCE_COUNT"

API_FIELDS_OK=$(echo "$BODY5" | jq '(.instances // []) as $i | ([$i[] | select(has("childIndex") and has("childItemId") and has("parentStep") and has("status") and has("durationMs") and has("retryCount") and has("attempts"))] | length) == ($i | length) and ($i | length) > 0' 2>/dev/null || echo false)
ck_eq "5. every instances[] entry carries childIndex/childItemId/parentStep/status/durationMs/retryCount/attempts" "$API_FIELDS_OK" "true"

API_PAIRS_JSON=$(echo "$BODY5" | jq -c '[.instances[] | [.childIndex, .childItemId, .parentStep]] | sort' 2>/dev/null)
DB_PAIRS_NORM=$(echo "$DB_PAIRS_JSON" | jq -c 'sort' 2>/dev/null)
ck_eq "5. instances[] (childIndex,childItemId,parentStep) set matches DB child rows exactly (order-independent)" "$API_PAIRS_JSON" "$DB_PAIRS_NORM"

se_summary
