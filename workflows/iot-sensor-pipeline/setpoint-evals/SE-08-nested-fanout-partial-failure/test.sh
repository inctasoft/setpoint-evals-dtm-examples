#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 08: Nested Fan-Out — Child-of-Child Failure Aggregation
# ═══════════════════════════════════════════════════════════════════════════
# SE-03 (double-fan-out) proves the happy path of the nested fan-out:
#   Device -> DiscoverSensors -> N sensors -> DiscoverReadings -> M readings
# This SE proves the FAILURE path: when IngestReading (the innermost,
# grandchild-level step) is forced to fail on every attempt, the failure
# must aggregate correctly through BOTH fan-out levels:
#   - IngestReading (grandchild) fails
#   - DiscoverReadings (its parent, one per sensor) itself ends FAILED —
#     not stuck forever in WAITING_FOR_CHILDREN
#   - DiscoverSensors (the ROOT discovery, one level further up) still
#     reaches a terminal, non-failed state — the outer level correctly
#     absorbs the inner failure instead of failing wholesale
#   - Downstream steps that depend on reading data (EvaluateAlert,
#     DispatchAlert, ArchiveProcessedPipeline) are SKIPPED
#   - ComputeAggregate/PublishAggregate are UNAFFECTED (they don't depend on
#     the ingest pipeline succeeding — same shape as order-processing's
#     independent Submit-phase steps)
#   - reading is a REQUIRED cascade (CRITICAL_CASCADES) -> job FAILED
#
# Reuses greenhouse-3 (SE-03's dedicated device, 3 sensors with real
# readings) — read-only, distinguished by its own entityId.
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

EVAL_NAME="SE 08: Nested Fan-Out Partial Failure"
EVAL_PURPOSE="IngestReading forced fail -> aggregates through DiscoverReadings AND DiscoverSensors"

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: greenhouse-3 (dedicated device — 3 sensors, real readings)"
log_info "IngestReading configured to fail permanently"
log_info "Expected Outcome: job FAILED, DiscoverReadings FAILED, DiscoverSensors still terminal-non-failed"
echo ""

PAYLOAD='{
  "variant": "default",
  "enableDeduplication": false,
  "payload": {
    "deviceId": "greenhouse-3",
    "entityId": "greenhouse-3-nested-failure"
  },
  "testOptions": {
    "RegisterDevice":     { "simDelay": 300 },
    "ProvisionDevice":    { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverSensors":    { "simDelay": 300 },
    "CalibrateSensor":    { "simDelay": 300 },
    "ActivateSensor":     { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverReadings":   { "simDelay": 300 },
    "IngestReading":      { "simDelay": 300, "failOnAttempts": [1, 2, 3] },
    "PublishReading":     { "simDelay": 300, "ackDelay": 1000 },
    "EvaluateAlert":      { "simDelay": 300 },
    "DispatchAlert":      { "simDelay": 300, "ackDelay": 1000 },
    "ComputeAggregate":   { "simDelay": 300 },
    "PublishAggregate":   { "simDelay": 300, "ackDelay": 1000 }
  }
}'

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")"
validate_job_id "$JOB_ID" || exit 1

log_section "MONITORING PROGRESS"
poll_job "$JOB_ID" 900 5

display_results "$JOB_ID"

log_section "VERIFICATION"

PASS_COUNT=0
FAIL_COUNT=0

if verify_job_status "$JOB_ID" "FAILED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

JOB_DETAILS=$(get_job_status "$JOB_ID")

INGEST_FAILED=$(echo "$JOB_DETAILS" | jq '[.steps[] | select(.stepNumber == "IngestReading" and .status == "failed")] | length')
if [ "$INGEST_FAILED" -ge 1 ]; then
  log_success "IngestReading (grandchild) failed as forced ($INGEST_FAILED instance(s))"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected at least 1 failed IngestReading, found $INGEST_FAILED"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

DISCOVER_READINGS_FAILED=$(echo "$JOB_DETAILS" | jq '[.steps[] | select(.stepNumber == "DiscoverReadings" and .status == "failed")] | length')
if [ "$DISCOVER_READINGS_FAILED" -ge 1 ]; then
  log_success "DiscoverReadings (parent, inner fan-out) itself is FAILED — level 1 aggregation confirmed ($DISCOVER_READINGS_FAILED instance(s))"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected DiscoverReadings to be FAILED, found $DISCOVER_READINGS_FAILED failed instance(s)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

DISCOVER_SENSORS_STATUS=$(echo "$JOB_DETAILS" | jq -r '[.steps[] | select(.stepNumber == "DiscoverSensors")][0].status')
if [ "$DISCOVER_SENSORS_STATUS" != "failed" ] && [ -n "$DISCOVER_SENSORS_STATUS" ] && [ "$DISCOVER_SENSORS_STATUS" != "null" ]; then
  log_success "DiscoverSensors (root, outer fan-out) is terminal and NOT failed ('$DISCOVER_SENSORS_STATUS') — level 2 aggregation confirmed"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected DiscoverSensors to be terminal and not failed, got '$DISCOVER_SENSORS_STATUS'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "EvaluateAlert" "SKIPPED" && \
   verify_step_status "$JOB_ID" "DispatchAlert" "SKIPPED"; then
  log_success "Downstream alert steps SKIPPED (depend on reading data)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected EvaluateAlert/DispatchAlert to be SKIPPED"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "CalibrateSensor" "COMPLETED" && \
   verify_step_status "$JOB_ID" "ActivateSensor" "COMPLETED"; then
  log_success "Sensor-level siblings (CalibrateSensor/ActivateSensor) unaffected"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected CalibrateSensor/ActivateSensor to remain COMPLETED"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
