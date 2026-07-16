#!/usr/bin/env bash
# GET /api/v1/kafka/topics is read-only (admin client, never consumes), reports
# connected:true against a real broker, and includes the core
# dtm.jobs.submitted topic with a non-negative approxMessageCount.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq/ck_has (pipefail-safe, mutate counters — never call in $()), se_skip, se_summary.
# NOTE: flat under setpoint-evals/ (SE-01..SE-23 convention — see SE-16's own comment); se-lib.sh
# is 2 levels up, NOT 3 (new-se.sh's nested-suite scaffold default would resolve one level too high).
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# Order-processing's helper chain gives us ORCHESTRATOR_HOST / API_VERSION — safe to
# source from any core SE regardless of workflow (chains to the generic shared/helpers.sh).
# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-20: kafka topics endpoint lists registered topics, never consumes"

# --- preflight ---------------------------------------------------------------
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
command -v jq >/dev/null 2>&1 || se_skip "jq is required"

# --- act -----------------------------------------------------------------------
RESPONSE=$(curl -s -w '\n%{http_code}' -m 15 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/kafka/topics")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

CONNECTED=$(echo "$BODY" | jq -r '.connected')
JOB_TOPIC=$(echo "$BODY" | jq -c '.topics[] | select(.name=="dtm.jobs.submitted")')
NEGATIVE_COUNT=$(echo "$BODY" | jq '[.topics[] | select(.approxMessageCount < 0)] | length' 2>/dev/null || echo -1)

# --- assert (1:1 with the README checkbox list) ---------------------------------
ck_eq "GET /api/v1/kafka/topics returns HTTP 200" "$HTTP_CODE" "200"
ck_eq "connected is true against the real local broker" "$CONNECTED" "true"
ck "the core dtm.jobs.submitted topic is present" test -n "$JOB_TOPIC"
ck_eq "dtm.jobs.submitted has at least 1 partition" \
  "$(echo "$JOB_TOPIC" | jq '.partitions >= 1')" "true"
ck_eq "no topic reports a negative approxMessageCount" "$NEGATIVE_COUNT" "0"

se_summary
