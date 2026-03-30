#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# STE 01: Happy Path
# ═══════════════════════════════════════════════════════════════════════════
# Verifies the standard end-to-end iot-sensor-pipeline flow:
#   1. Initiate a job with payload.entityId="DEV-001"
#   2. All pipeline steps complete successfully
#   3. Fan-out: Device -> Sensors -> Readings (double fan-out)
#   4. Alert and Aggregate steps complete
#   5. Job reaches COMPLETED status
#
# Uses the "default" variant (full pipeline with double fan-out).
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="STE 01: Happy Path"
EVAL_PURPOSE="Test standard successful iot-sensor-pipeline with default variant"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: DEV-001"
log_info "Variant: default"
log_info "Expected Outcome: Job COMPLETES successfully (all steps pass)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB"

PAYLOAD='{
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

# Test 2: RegisterDevice should be COMPLETED
if verify_step_status "$JOB_ID" "RegisterDevice" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: ProvisionDevice should be COMPLETED
if verify_step_status "$JOB_ID" "ProvisionDevice" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: DiscoverSensors should be COMPLETED
if verify_step_status "$JOB_ID" "DiscoverSensors" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 5: DispatchAlert should be COMPLETED
if verify_step_status "$JOB_ID" "DispatchAlert" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 6: PublishAggregate should be COMPLETED
if verify_step_status "$JOB_ID" "PublishAggregate" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
