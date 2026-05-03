#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 03: Double Fan-Out (Nested Fan-Out)
# ═══════════════════════════════════════════════════════════════════════════
# Tests the nested Discovery + Fan-Out pattern:
#   Device -> DiscoverSensors -> N x (CalibrateSensor -> ActivateSensor ->
#             DiscoverReadings -> M x (IngestReading -> PublishReading))
#
# A device with 3 sensors, each with N readings, produces:
#   - 3 CalibrateSensor child steps
#   - 3 ActivateSensor child steps
#   - 3 DiscoverReadings steps (one per sensor)
#   - M x 3 IngestReading child steps
#   - M x 3 PublishReading child steps
#
# We verify:
#   1. DiscoverSensors completes and spawns child steps
#   2. Multiple CalibrateSensor child steps are created
#   3. DiscoverReadings steps are created (nested fan-out)
#   4. Multiple IngestReading child steps are created
#   5. Job reaches COMPLETED status
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 03: Double Fan-Out (Nested)"
EVAL_PURPOSE="Test nested Discovery + Fan-Out: Device -> Sensors -> Readings"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: DEV-001 (device with 3 sensors, each with N readings)"
log_info "Variant: default (includes double fan-out)"
log_info "Expected Outcome: Nested fan-out creates multi-level child steps, job COMPLETES"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with Device Having Multiple Sensors
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (DOUBLE FAN-OUT SCENARIO)"

PAYLOAD='{
  "enableDeduplication": false,
  "variant": "default",
  "payload": {
    "deviceId": "DEV-001",
    "entityId": "DEV-001"
  },
  "testOptions": {
    "RegisterDevice":       { "simDelay": 300 },
    "ProvisionDevice":     { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverSensors":     { "simDelay": 300 },
    "CalibrateSensor":       { "simDelay": 300 },
    "ActivateSensor":     { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverReadings":    { "simDelay": 300 },
    "IngestReading":      { "simDelay": 300 },
    "PublishReading":    { "simDelay": 300, "ackDelay": 1000 },
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

# Small delay to allow final ACKs to be processed
sleep 2

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

# Test 1: Job status should be COMPLETED
if verify_job_status "$JOB_ID" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 2: DiscoverSensors should be COMPLETED
if verify_step_status "$JOB_ID" "DiscoverSensors" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 5: Fan-Out Pattern Verification
# ═══════════════════════════════════════════════════════════════════════════

log_section "FAN-OUT PATTERN VERIFICATION"

JOB_DETAILS=$(get_job_status "$JOB_ID")

# Count fan-out child steps
EXTRACT_SENSOR_COUNT=0
TRANSFORM_SENSOR_COUNT=0
DISCOVER_READINGS_COUNT=0
EXTRACT_READING_COUNT=0
TRANSFORM_READING_COUNT=0

if command -v jq &> /dev/null; then
  EXTRACT_SENSOR_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "CalibrateSensor")] | length' 2>/dev/null || echo "0")
  TRANSFORM_SENSOR_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "ActivateSensor")] | length' 2>/dev/null || echo "0")
  DISCOVER_READINGS_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "DiscoverReadings")] | length' 2>/dev/null || echo "0")
  EXTRACT_READING_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "IngestReading")] | length' 2>/dev/null || echo "0")
  TRANSFORM_READING_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "PublishReading")] | length' 2>/dev/null || echo "0")
fi

log_info "CalibrateSensor child steps: ${EXTRACT_SENSOR_COUNT}"
log_info "ActivateSensor child steps: ${TRANSFORM_SENSOR_COUNT}"
log_info "DiscoverReadings steps: ${DISCOVER_READINGS_COUNT}"
log_info "IngestReading child steps: ${EXTRACT_READING_COUNT}"
log_info "PublishReading child steps: ${TRANSFORM_READING_COUNT}"

# Test 3: At least 1 CalibrateSensor child step should exist
if [ "${EXTRACT_SENSOR_COUNT}" -gt 0 ]; then
  log_success "CalibrateSensor child steps created: ${EXTRACT_SENSOR_COUNT}"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "No CalibrateSensor child steps found - fan-out not creating children!"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: At least 1 DiscoverReadings step should exist (nested fan-out trigger)
if [ "${DISCOVER_READINGS_COUNT}" -gt 0 ]; then
  log_success "DiscoverReadings nested fan-out steps created: ${DISCOVER_READINGS_COUNT}"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "No DiscoverReadings steps found - nested fan-out not triggering!"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 5: At least 1 IngestReading child step should exist (nested children)
if [ "${EXTRACT_READING_COUNT}" -gt 0 ]; then
  log_success "IngestReading nested child steps created: ${EXTRACT_READING_COUNT}"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "No IngestReading child steps found - nested fan-out children not created!"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 6: Verify all PublishReading steps completed (with retry for race condition)
if [ "${TRANSFORM_READING_COUNT}" -gt 0 ] && command -v jq &> /dev/null; then
  log_info "Waiting for PublishReading steps to complete (with retry)..."

  MAX_STEP_VERIFY_ATTEMPTS=15
  STEP_VERIFY_PASSED=false

  for step_attempt in $(seq 1 $MAX_STEP_VERIFY_ATTEMPTS); do
    JOB_DETAILS=$(get_job_status "$JOB_ID")
    TRANSFORM_READING_COMPLETED=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "PublishReading" and .status == "completed")] | length')

    if [ "${TRANSFORM_READING_COMPLETED}" -ge "${TRANSFORM_READING_COUNT}" ]; then
      log_success "All ${TRANSFORM_READING_COMPLETED} PublishReading steps completed"
      PASS_COUNT=$((PASS_COUNT + 1))
      STEP_VERIFY_PASSED=true
      break
    fi

    if [ $step_attempt -lt $MAX_STEP_VERIFY_ATTEMPTS ]; then
      log_info "Attempt $step_attempt/$MAX_STEP_VERIFY_ATTEMPTS: PublishReading steps completing (${TRANSFORM_READING_COMPLETED}/${TRANSFORM_READING_COUNT})..."
      sleep 1
    fi
  done

  if [ "$STEP_VERIFY_PASSED" = false ]; then
    log_error "Not all PublishReading steps completed: ${TRANSFORM_READING_COMPLETED}/${TRANSFORM_READING_COUNT}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
