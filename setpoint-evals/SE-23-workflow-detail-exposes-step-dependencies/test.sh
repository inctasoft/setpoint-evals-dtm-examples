#!/usr/bin/env bash
# GET /api/v1/workflows/:workflowName (pre-existing endpoint, Phase 4a) is what
# the monitor's new per-workflow DAG mini-viz reads for its mermaid nodes/edges
# (stepsByVariant[variant][].dependencies) — this SE pins the CONTRACT that
# view depends on: at least one real edge, and every dependency string
# resolves to a real step name in the same variant (an orphan edge would
# silently break mermaid's flowchart parser client-side).
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

log_info "SE-23: workflow detail exposes a well-formed step-dependency graph (DAG contract)"

# --- preflight ---------------------------------------------------------------
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
command -v jq >/dev/null 2>&1 || se_skip "jq is required"

API="${ORCHESTRATOR_HOST}/api/${API_VERSION}"

# --- act -----------------------------------------------------------------------
RESPONSE=$(curl -s -w '\n%{http_code}' -m 15 "${API}/workflows/order-processing")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

DEFAULT_VARIANT=$(echo "$BODY" | jq -r '.defaultVariant')
STEP_COUNT=$(echo "$BODY" | jq --arg v "$DEFAULT_VARIANT" '.stepsByVariant[$v] | length')
EDGE_COUNT=$(echo "$BODY" | jq --arg v "$DEFAULT_VARIANT" '[.stepsByVariant[$v][].dependencies[]] | length')

# Every dependency string must resolve to a real step name in the same variant.
ORPHAN_EDGES=$(echo "$BODY" | jq --arg v "$DEFAULT_VARIANT" '
  (.stepsByVariant[$v] | map(.step)) as $names
  | [.stepsByVariant[$v][].dependencies[] | select(. as $d | $names | index($d) | not)]
  | length')

# --- assert (1:1 with the README checkbox list) ---------------------------------
ck_eq "GET /api/v1/workflows/order-processing returns HTTP 200" "$HTTP_CODE" "200"
ck "defaultVariant's step list is non-empty" test "$STEP_COUNT" -gt 0
ck "at least one real dependency edge exists (not all isolated nodes)" test "$EDGE_COUNT" -gt 0
ck_eq "no dependency string is an orphan (every edge resolves to a real step)" "$ORPHAN_EDGES" "0"

se_summary
