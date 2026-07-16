#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 09: Inner-Empty Discovery (Mixed Sensor Set)
# ═══════════════════════════════════════════════════════════════════════════
# SE-05 (empty-discovery) already proves the case where a device's ONLY
# sensor has zero readings. This SE proves the DIFFERENT, mixed case: a
# device with MULTIPLE sensors, where exactly ONE has zero readings while
# its SIBLING has real data — the empty result must not affect its sibling,
# and must not fail the pipeline.
#
# Dedicated to greenhouse-5: 2 sensors — SENS-GH5-TEMP (6 real readings),
# SENS-GH5-SOIL (0 readings, deliberately) — see ../../source-db/SEED-REGISTRY.md.
#
# Expected behavior:
#   1. DiscoverSensors finds 2 sensors, fans out to both
#   2. DiscoverReadings for SENS-GH5-SOIL completes with 0/null children
#   3. DiscoverReadings for SENS-GH5-TEMP completes with 6 real children
#   4. No IngestReading/PublishReading children exist for the SOIL branch
#   5. IngestReading/PublishReading children DO exist for the TEMP branch
#   6. Job reaches COMPLETED status (empty is a valid outcome, not a failure)
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

EVAL_NAME="SE 09: Inner-Empty Discovery (Mixed Sensor Set)"
EVAL_PURPOSE="One sensor empty amid a sibling WITH data — mixed case, distinct from SE-05"

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: greenhouse-5 (dedicated device — TEMP has data, SOIL is empty)"
log_info "Variant: default"
log_info "Expected Outcome: job COMPLETES; SOIL's DiscoverReadings is empty but COMPLETED"
echo ""

PAYLOAD='{
  "variant": "default",
  "enableDeduplication": false,
  "payload": {
    "deviceId": "greenhouse-5",
    "entityId": "greenhouse-5-inner-empty"
  },
  "testOptions": {
    "RegisterDevice":     { "simDelay": 300 },
    "ProvisionDevice":    { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverSensors":    { "simDelay": 300 },
    "CalibrateSensor":    { "simDelay": 300 },
    "ActivateSensor":     { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverReadings":   { "simDelay": 300 },
    "IngestReading":      { "simDelay": 300 },
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
poll_job "$JOB_ID" 600 5

display_results "$JOB_ID"

log_section "VERIFICATION"

PASS_COUNT=0
FAIL_COUNT=0

if verify_job_status "$JOB_ID" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

JOB_DETAILS=$(get_job_status "$JOB_ID")

SOIL_DISCOVER=$(echo "$JOB_DETAILS" | jq '[.steps[] | select(.stepNumber == "DiscoverReadings" and .childItemId == "SENS-GH5-SOIL")]')
SOIL_DISCOVER_COMPLETED=$(echo "$SOIL_DISCOVER" | jq '[.[] | select(.status == "completed")] | length')
if [ "$SOIL_DISCOVER_COMPLETED" -ge 1 ]; then
  log_success "DiscoverReadings for SENS-GH5-SOIL (empty sensor) is COMPLETED, not failed"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected DiscoverReadings for SENS-GH5-SOIL to be COMPLETED"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

TEMP_DISCOVER_WITH_CHILDREN=$(echo "$JOB_DETAILS" | jq '[.steps[] | select(.stepNumber == "DiscoverReadings" and .childItemId == "SENS-GH5-TEMP" and .childCount == 6)] | length')
if [ "$TEMP_DISCOVER_WITH_CHILDREN" -ge 1 ]; then
  log_success "DiscoverReadings for SENS-GH5-TEMP (sibling WITH data) reports childCount=6"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected DiscoverReadings for SENS-GH5-TEMP to report childCount=6"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

INGEST_COUNT=$(echo "$JOB_DETAILS" | jq '[.steps[] | select(.stepNumber == "IngestReading")] | length')
if [ "$INGEST_COUNT" -ge 1 ]; then
  log_success "IngestReading children exist ($INGEST_COUNT) — from the TEMP sibling only"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected at least 1 IngestReading child (from SENS-GH5-TEMP), found 0"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "DiscoverSensors" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
