#!/usr/bin/env bash
# GET /api/v1/evals discovers exactly the on-disk SE-* estate (same predicate
# se-run-suite.sh uses), with parseable payloads and graceful degradation for
# missing/malformed Payload sections. No bundled manifest — this SE fails if
# discovery and the filesystem ever disagree.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq/ck_has (pipefail-safe, mutate counters — never call in $()), se_skip, se_summary.
# NOTE: this SE is FLAT under setpoint-evals/ (SE-01..SE-19 convention), so se-lib.sh is 2
# levels up (mirrors SE-14/SE-15's own path comment — the generic se_root() assumes the
# nested setpoint-evals/<suite>/SE-x/ layout and would resolve one level too high here).
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# Order-processing's helper chain gives us ORCHESTRATOR_HOST / API_VERSION / jq-based
# helpers — safe to source from any SE regardless of workflow (it just chains to the
# generic setpoint-evals/shared/helpers.sh).
# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-16: evals discovery lists all (count parity + payload parsing)"

# --- preflight ---------------------------------------------------------------
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
command -v jq >/dev/null 2>&1 || se_skip "jq is required"

# --- arrange: count the on-disk SE-* estate with the SAME predicate discovery uses ---
count_dir() {
  local dir="$1" n=0
  [ -d "$dir" ] || { echo 0; return; }
  for d in "$dir"/SE-*; do
    [ -d "$d" ] || continue
    [ "$(basename "$d")" = "00-template" ] && continue
    [ -f "$d/test.sh" ] && n=$((n + 1))
  done
  echo "$n"
}

CORE_COUNT=$(count_dir "$ROOT/setpoint-evals")
OP_COUNT=$(count_dir "$ROOT/workflows/order-processing/setpoint-evals")
IOT_COUNT=$(count_dir "$ROOT/workflows/iot-sensor-pipeline/setpoint-evals")
INFRA_COUNT=$(count_dir "$ROOT/workflows/infra-provisioning/setpoint-evals")
EXPECTED_TOTAL=$((CORE_COUNT + OP_COUNT + IOT_COUNT + INFRA_COUNT))
log_info "on-disk: core=${CORE_COUNT} order-processing=${OP_COUNT} iot-sensor-pipeline=${IOT_COUNT} infra-provisioning=${INFRA_COUNT} total=${EXPECTED_TOTAL}"

# --- act -----------------------------------------------------------------------
RESPONSE=$(curl -s -w '\n%{http_code}' -m 15 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/evals")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

ACTUAL_TOTAL=$(echo "$BODY" | jq 'length' 2>/dev/null || echo -1)
INVALID_SUITE_COUNT=$(echo "$BODY" | jq '
  [.[] | select(.suite as $s |
    (["core","order-processing","iot-sensor-pipeline","infra-provisioning"] | index($s)) == null)]
  | length' 2>/dev/null || echo -1)
SE04=$(echo "$BODY" | jq -c '.[] | select(.suite=="core" and .id=="SE-04-ack-delays")' 2>/dev/null)
SE14=$(echo "$BODY" | jq -c '.[] | select(.suite=="core" and .id=="SE-14-schema-single-source")' 2>/dev/null)
SE18=$(echo "$BODY" | jq -c '.[] | select(.suite=="core" and .id=="SE-18-evals-run-malformed-payload-422")' 2>/dev/null)

# --- assert (1:1 with the README checkbox list) ---------------------------------
ck_eq "GET /api/v1/evals returns HTTP 200" "$HTTP_CODE" "200"
ck_eq "response array length equals the on-disk SE-* count" "$ACTUAL_TOTAL" "$EXPECTED_TOTAL"
ck_eq "every element's suite is one of the four known suites" "$INVALID_SUITE_COUNT" "0"
ck_eq "SE-04-ack-delays payload.json.variant == quick-order" \
  "$(echo "$SE04" | jq -r '.payload.json.variant')" "quick-order"
ck_eq "SE-14-schema-single-source has no payload.json (no Payload section)" \
  "$(echo "$SE14" | jq -r '.payload.json // "absent"')" "absent"
ck_eq "SE-18 (broken JSON) is present with a payload.parseError, not dropped/crashed" \
  "$(echo "$SE18" | jq -r 'if .payload.parseError then "has-error" else "missing" end')" "has-error"

se_summary
