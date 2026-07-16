#!/usr/bin/env bash
# GET /api/v1/workflows/:workflowName/flags resolves order-processing's REAL
# committed featureFlags.defaults (workflow.config.ts) — pins the flags the
# monitor's "Flags" tab renders, and that a 404 on an unknown workflow name
# never silently returns an empty flags object instead.
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

log_info "SE-22: workflow flags endpoint resolves real order-processing defaults"

# --- preflight ---------------------------------------------------------------
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
command -v jq >/dev/null 2>&1 || se_skip "jq is required"

API="${ORCHESTRATOR_HOST}/api/${API_VERSION}"

# --- act -----------------------------------------------------------------------
RESPONSE=$(curl -s -w '\n%{http_code}' -m 15 "${API}/workflows/order-processing/flags")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

NOT_FOUND_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "${API}/workflows/does-not-exist-workflow/flags")

# --- assert (1:1 with the README checkbox list) ---------------------------------
ck_eq "GET /api/v1/workflows/order-processing/flags returns HTTP 200" "$HTTP_CODE" "200"
ck_eq "response echoes workflow=order-processing" "$(echo "$BODY" | jq -r '.workflow')" "order-processing"
ck_eq "ENABLE_DEDUPLICATION resolves to the workflow.config.ts default (true)" \
  "$(echo "$BODY" | jq -r '.flags.ENABLE_DEDUPLICATION')" "true"
ck_eq "ENABLE_SHIPMENT_TRACKING resolves to the workflow.config.ts default (true)" \
  "$(echo "$BODY" | jq -r '.flags.ENABLE_SHIPMENT_TRACKING')" "true"
ck_eq "clientOverridable is exactly the config's allowlist (2 entries)" \
  "$(echo "$BODY" | jq -c '.clientOverridable | sort')" \
  '["ENABLE_DEDUPLICATION","ENABLE_SHIPMENT_TRACKING"]'
ck_eq "an unknown workflow name 404s (never silently empty flags)" "$NOT_FOUND_HTTP" "404"

se_summary
