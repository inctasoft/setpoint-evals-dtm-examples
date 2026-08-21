#!/usr/bin/env bash
# POST /api/v1/evals/:suite/:id/run re-issues each eval's own README Payload as
# a real job (via WorkflowJobService, the exact same path a real POST
# /workflows/:name/jobs would take) and the resulting job reaches a terminal
# state for one representative eval per suite.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq (pipefail-safe, mutate counters — never call in $()), se_skip, se_summary.
# NOTE: this SE is FLAT under setpoint-evals/ (SE-01..SE-19 convention), so se-lib.sh is 2
# levels up (mirrors SE-14/SE-15's own path comment).
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# Order-processing's helper chain gives us ORCHESTRATOR_HOST / API_VERSION / ORCHESTRATOR_URL /
# get_job_status / extract_job_status — all workflow-agnostic (jobs/:id by id), safe to use
# regardless of which workflow actually ran the job.
# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-17: eval run round-trip reaches a terminal job state (one eval per suite)"

# --- preflight ---------------------------------------------------------------
# Retry-poll (loaded hosts boot the orchestrator slowly after recreate-heavy SEs)
se_wait_orchestrator_health 90 2 \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"

EVALS_API="${ORCHESTRATOR_HOST}/api/${API_VERSION}/evals"

# poll_until_terminal <job_id> <max_seconds> -> echoes final status, returns 0 iff terminal
poll_until_terminal() {
  local job_id="$1" max_seconds="$2" interval=3 elapsed=0 status
  while [ "$elapsed" -lt "$max_seconds" ]; do
    status=$(extract_job_status "$(get_job_status "$job_id")")
    case "${status,,}" in
      completed | failed | partial_success)
        echo "$status"
        return 0
        ;;
    esac
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  echo "${status:-unknown}"
  return 1
}

run_and_check() {
  local suite="$1" id="$2" budget="$3"
  log_info "-> ${suite}/${id} (budget ${budget}s)"

  local response http_code body job_id
  response=$(curl -s -w '\n%{http_code}' -m 15 -X POST "${EVALS_API}/${suite}/${id}/run")
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')
  job_id=$(echo "$body" | jq -r '.jobId // empty' 2>/dev/null)

  ck_eq "${suite}/${id}: POST /run returns 201" "$http_code" "201"
  ck "${suite}/${id}: response has a non-empty jobId" test -n "$job_id"

  if [ -z "$job_id" ]; then
    # log_warn, NOT log_fail (server-config #755): the message says it itself — the
    # `ck "...: response has a non-empty jobId"` above ALREADY counted this. Since #755 made
    # log_fail increment _SE_FAIL, a log_fail here is a literal double-count.
    log_warn "${suite}/${id}: no jobId returned — skipping poll (already counted as a failed assertion above)"
    return
  fi

  local final_status is_terminal
  final_status=$(poll_until_terminal "$job_id" "$budget")
  case "${final_status,,}" in
    completed | failed | partial_success) is_terminal="terminal" ;;
    *) is_terminal="NOT-terminal" ;;
  esac
  ck_eq "${suite}/${id}: job reaches a terminal status within ${budget}s (got '${final_status}')" \
    "$is_terminal" "terminal"
}

# --- act + assert (1:1 with the README checkbox list) --------------------------
run_and_check "core" "SE-04-ack-delays" 60
run_and_check "order-processing" "SE-01-happy-path" 90
run_and_check "iot-sensor-pipeline" "SE-01-happy-path" 120
run_and_check "infra-provisioning" "SE-01-happy-path" 120

se_summary
