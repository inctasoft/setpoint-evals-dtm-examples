#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 02: Device Not Found
# ═══════════════════════════════════════════════════════════════════════════
# Tests error handling when initiating a job for a non-existent device.
#
# Expected behavior:
#   1. RegisterDevice step fails (device not in source DB)
#   2. Device is a CRITICAL entity (criticality: "required")
#   3. Outcome rule "critical-entity-failed" fires
#   4. Job reaches FAILED status
#   5. Downstream steps (ProvisionDevice, DiscoverSensors, etc.) do not execute
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 02: Device Not Found"
EVAL_PURPOSE="Test failure handling when critical entity (device) does not exist"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: DEV-99999 (does NOT exist in source DB)"
log_info "Variant: default"
log_info "Expected Outcome: Job FAILS (critical entity failed)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with Non-Existent Device
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (NON-EXISTENT DEVICE)"

PAYLOAD='{
  "variant": "default",
  "payload": {
    "deviceId": "DEV-99999",
    "entityId": "DEV-99999"
  },
  "testOptions": {
    "RegisterDevice":       { "simDelay": 300, "maxRetries": 0 },
    "ProvisionDevice":     { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverSensors":     { "simDelay": 300 },
    "CalibrateSensor":       { "simDelay": 300 },
    "ActivateSensor":     { "simDelay": 300, "ackDelay": 1000 }
  }
}'

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")"
validate_job_id "$JOB_ID" || exit 1

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Monitor Progress (expect failure)
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 2: MONITORING PROGRESS (EXPECTING FAILURE)"

poll_job "$JOB_ID" 300 5

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

# Test 1: Job status should be FAILED
if verify_job_status "$JOB_ID" "FAILED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 2: RegisterDevice should be FAILED
if verify_step_status "$JOB_ID" "RegisterDevice" "FAILED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: ProvisionDevice should NOT be COMPLETED (dependency failed)
FINAL_STATUS_JSON=$(get_job_status "$JOB_ID")
TD_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "ProvisionDevice")

if [[ "${TD_STATUS,,}" != "completed" ]]; then
  log_success "ProvisionDevice correctly NOT completed (status: ${TD_STATUS})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "ProvisionDevice should NOT be completed when RegisterDevice fails"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: DiscoverSensors should NOT be COMPLETED (depends on ProvisionDevice)
DS_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "DiscoverSensors")

if [[ "${DS_STATUS,,}" != "completed" ]]; then
  log_success "DiscoverSensors correctly NOT completed (status: ${DS_STATUS})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "DiscoverSensors should NOT be completed when RegisterDevice fails"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
