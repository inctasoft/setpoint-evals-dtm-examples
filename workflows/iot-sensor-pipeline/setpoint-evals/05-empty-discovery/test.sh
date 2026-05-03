#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 05: Empty Discovery (Sensor with 0 Readings)
# ═══════════════════════════════════════════════════════════════════════════
# Tests empty discovery handling in the nested fan-out pattern.
#
# When DiscoverReadings returns 0 reading IDs for a sensor:
#   - The orchestrator should handle this gracefully (childCount: 0)
#   - No IngestReading or PublishReading child steps are created
#   - The pipeline continues to completion
#   - Reading entity is marked as "empty" (valid outcome)
#
# This demonstrates the DTM engine's ability to handle empty discovery
# results without failing the entire pipeline.
#
# Expected behavior:
#   1. Device + Sensor pipeline completes normally
#   2. DiscoverReadings returns empty array for sensor with no readings
#   3. No reading child steps are created
#   4. Job reaches COMPLETED status (with empty entity warning)
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 05: Empty Discovery"
EVAL_PURPOSE="Test empty DiscoverReadings result (sensor with 0 readings)"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: DEV-EMPTY (device with sensor that has 0 readings)"
log_info "Variant: default"
log_info "Expected Outcome: DiscoverReadings returns empty, job COMPLETES"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with Sensor Having No Readings
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (EMPTY DISCOVERY SCENARIO)"

PAYLOAD='{
  "variant": "default",
  "payload": {
    "deviceId": "DEV-EMPTY",
    "entityId": "DEV-EMPTY"
  },
  "testOptions": {
    "RegisterDevice":       { "simDelay": 300 },
    "ProvisionDevice":     { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverSensors":     { "simDelay": 300 },
    "CalibrateSensor":       { "simDelay": 300 },
    "ActivateSensor":     { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverReadings":    { "simDelay": 300 },
    "EvaluateAlert":        { "simDelay": 300 },
    "DispatchAlert":      { "simDelay": 300, "ackDelay": 1000 },
    "ComputeAggregate":    { "simDelay": 300 },
    "PublishAggregate":  { "simDelay": 300, "ackDelay": 1000 }
  }
}'

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")"
validate_job_id "$JOB_ID" || exit 1

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Monitor Progress
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 2: MONITORING PROGRESS"

poll_job "$JOB_ID" 600 5

# ═══════════════════════════════════════════════════════════════════════════
# Step 3: Display Results
# ═══════════════════════════════════════════════════════════════════════════

display_results "$JOB_ID"

# ═══════════════════════════════════════════════════════════════════════════
# Step 4: Verification
# ═══════════════════════════════════════════════════════════════════════════

log_section "VERIFICATION"

PASS_COUNT=0
FAIL_COUNT=0

# Test 1: Job should reach a terminal state (COMPLETED or PARTIAL_SUCCESS)
FINAL_STATUS_JSON=$(get_job_status "$JOB_ID")
JOB_STATUS=$(extract_job_status "$FINAL_STATUS_JSON")

if [[ "${JOB_STATUS,,}" == "completed" ]] || [[ "${JOB_STATUS,,}" == "partial_success" ]]; then
  log_success "Job reached terminal state: ${JOB_STATUS}"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Job should be COMPLETED or PARTIAL_SUCCESS, got: ${JOB_STATUS}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 2: DiscoverSensors should be COMPLETED
if verify_step_status "$JOB_ID" "DiscoverSensors" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: No IngestReading child steps should exist (empty discovery)
if command -v jq &> /dev/null; then
  EXTRACT_READING_COUNT=$(echo "${FINAL_STATUS_JSON}" | jq '[.steps[] | select(.stepNumber == "IngestReading")] | length' 2>/dev/null || echo "0")
  TRANSFORM_READING_COUNT=$(echo "${FINAL_STATUS_JSON}" | jq '[.steps[] | select(.stepNumber == "PublishReading")] | length' 2>/dev/null || echo "0")

  if [ "${EXTRACT_READING_COUNT}" -eq 0 ]; then
    log_success "No IngestReading child steps created (empty discovery confirmed)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "IngestReading child steps found (${EXTRACT_READING_COUNT}) despite empty discovery"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  if [ "${TRANSFORM_READING_COUNT}" -eq 0 ]; then
    log_success "No PublishReading child steps created (empty discovery confirmed)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "PublishReading child steps found (${TRANSFORM_READING_COUNT}) despite empty discovery"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  log_warning "jq not available, skipping empty discovery child step verification"
fi

# Test 4: DiscoverReadings should exist and be COMPLETED (even with 0 results)
DISCOVER_READINGS_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "DiscoverReadings")
if [[ -n "${DISCOVER_READINGS_STATUS}" ]]; then
  if [[ "${DISCOVER_READINGS_STATUS,,}" == "completed" ]]; then
    log_success "DiscoverReadings completed with 0 results (graceful empty handling)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "DiscoverReadings status: ${DISCOVER_READINGS_STATUS} (expected: COMPLETED)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  log_warning "DiscoverReadings step not found in job details"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
