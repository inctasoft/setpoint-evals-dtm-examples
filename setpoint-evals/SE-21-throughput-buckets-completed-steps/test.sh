#!/usr/bin/env bash
# GET /api/v1/metrics/throughput aggregates REAL dtm_steps.completed_at rows
# into minute buckets — after running a real order-processing job to a
# terminal state, the workflow-scoped throughput total must be >= that job's
# own completed-step count (>= not == because other concurrent SE runs may
# add order-processing steps in the same window — see docs/setpoint-eval-
# conventions.md on shared-DB isolation).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq (pipefail-safe, mutate counters — never call in $()), se_skip, se_summary.
# NOTE: flat under setpoint-evals/ (SE-01..SE-23 convention); se-lib.sh is 2 levels up, NOT 3
# (new-se.sh's nested-suite scaffold default would resolve one level too high here).
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-21: throughput endpoint counts a real job's completed steps"

# --- preflight ---------------------------------------------------------------
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
command -v jq >/dev/null 2>&1 || se_skip "jq is required"

API="${ORCHESTRATOR_HOST}/api/${API_VERSION}"

poll_until_terminal() {
  local job_id="$1" max_seconds="$2" interval=3 elapsed=0 status
  while [ "$elapsed" -lt "$max_seconds" ]; do
    status=$(extract_job_status "$(get_job_status "$job_id")")
    case "${status,,}" in
      completed | failed | partial_success) echo "$status"; return 0 ;;
    esac
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  echo "${status:-unknown}"
  return 1
}

# --- arrange: run a real order-processing job to a terminal state ------------
RUN_RESPONSE=$(curl -s -w '\n%{http_code}' -m 15 -X POST "${API}/evals/order-processing/SE-01-happy-path/run")
RUN_HTTP=$(echo "$RUN_RESPONSE" | tail -n1)
RUN_BODY=$(echo "$RUN_RESPONSE" | sed '$d')
JOB_ID=$(echo "$RUN_BODY" | jq -r '.jobId // empty')

[ "$RUN_HTTP" = "201" ] && [ -n "$JOB_ID" ] || se_skip "could not create the seed job (run API returned ${RUN_HTTP})"

FINAL_STATUS=$(poll_until_terminal "$JOB_ID" 90)
case "${FINAL_STATUS,,}" in
  completed | failed | partial_success) : ;;
  *) se_skip "seed job never reached a terminal state (got '${FINAL_STATUS}') — cannot assert on its completed steps" ;;
esac

JOB_DETAIL=$(get_job_status "$JOB_ID")
JOB_COMPLETED_STEPS=$(echo "$JOB_DETAIL" | jq '[.steps[] | select(.status=="completed")] | length')

# --- act -----------------------------------------------------------------------
THROUGHPUT_RESPONSE=$(curl -s -w '\n%{http_code}' -m 15 \
  "${API}/metrics/throughput?workflow=order-processing&windowMinutes=5")
TP_HTTP=$(echo "$THROUGHPUT_RESPONSE" | tail -n1)
TP_BODY=$(echo "$THROUGHPUT_RESPONSE" | sed '$d')

TOTAL_COMPLETED=$(echo "$TP_BODY" | jq -r '.totalCompleted')
WORKFLOW_ECHO=$(echo "$TP_BODY" | jq -r '.workflow')
WINDOW_ECHO=$(echo "$TP_BODY" | jq -r '.windowMinutes')
BUCKET_SUM=$(echo "$TP_BODY" | jq '[.buckets[].completed] | add // 0')

# --- assert (1:1 with the README checkbox list) ---------------------------------
ck_eq "GET /api/v1/metrics/throughput returns HTTP 200" "$TP_HTTP" "200"
ck_eq "response echoes workflow=order-processing" "$WORKFLOW_ECHO" "order-processing"
ck_eq "response echoes windowMinutes=5" "$WINDOW_ECHO" "5"
ck_eq "sum of per-bucket completed counts equals totalCompleted (internal consistency)" \
  "$BUCKET_SUM" "$TOTAL_COMPLETED"
ck "totalCompleted >= this job's own completed-step count (${JOB_COMPLETED_STEPS})" \
  test "$TOTAL_COMPLETED" -ge "$JOB_COMPLETED_STEPS"

se_summary
