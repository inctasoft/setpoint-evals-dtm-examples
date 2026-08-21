#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 04: Feature Flag — Disable Alerts
# ═══════════════════════════════════════════════════════════════════════════
# Tests the ENABLE_ALERT_GENERATION feature flag.
#
# When ENABLE_ALERT_GENERATION is set to false:
#   - EvaluateAlert and DispatchAlert steps should be SKIPPED
#   - All other steps proceed normally
#   - Job should still COMPLETE successfully
#
# This demonstrates the DTM engine's conditional step execution
# based on workflow feature flags.
#
# Expected behavior:
#   1. Device, Sensor, Reading pipeline completes normally
#   2. Alert steps are SKIPPED (feature flag disabled)
#   3. Aggregate steps proceed normally
#   4. Job reaches COMPLETED status
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 04: Feature Flag — Disable Alerts"
EVAL_PURPOSE="Test ENABLE_ALERT_GENERATION: false skips alert steps"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: greenhouse-4 (dedicated device — has a real heat-spike alert)"
log_info "Variant: default"
log_info "Feature Flag: ENABLE_ALERT_GENERATION = false"
log_info "Expected Outcome: Job COMPLETES, alert steps SKIPPED"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with Alert Generation Disabled
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (ALERTS DISABLED)"

PAYLOAD='{
  "enableDeduplication": false,
  "variant": "default",
  "payload": {
    "deviceId": "greenhouse-4",
    "entityId": "greenhouse-4"
  },
  "featureFlags": {
    "ENABLE_ALERT_GENERATION": false
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

poll_job "$JOB_ID" 900 5

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

# Test 2: Core pipeline steps should be COMPLETED
if verify_step_status "$JOB_ID" "RegisterDevice" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "ProvisionDevice" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "DiscoverSensors" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: Alert steps should be SKIPPED (feature flag disabled)
FINAL_STATUS_JSON=$(get_job_status "$JOB_ID")

if command -v jq &> /dev/null; then
  EA_COUNT=$(echo "${FINAL_STATUS_JSON}" | jq '[.steps[] | select(.stepNumber == "EvaluateAlert")] | length' 2>/dev/null || echo "0")
  TA_COUNT=$(echo "${FINAL_STATUS_JSON}" | jq '[.steps[] | select(.stepNumber == "DispatchAlert")] | length' 2>/dev/null || echo "0")

  EA_STATUS=""
  TA_STATUS=""
  if [ "${EA_COUNT}" -gt 0 ]; then
    EA_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "EvaluateAlert")
  fi
  if [ "${TA_COUNT}" -gt 0 ]; then
    TA_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "DispatchAlert")
  fi

  # Alert steps should either not exist or be SKIPPED
  if [ "${EA_COUNT}" -eq 0 ] || [[ "${EA_STATUS,,}" == "skipped" ]]; then
    log_success "EvaluateAlert correctly skipped/absent (count: ${EA_COUNT}, status: ${EA_STATUS:-N/A})"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "EvaluateAlert should be skipped when ENABLE_ALERT_GENERATION=false (status: ${EA_STATUS})"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  if [ "${TA_COUNT}" -eq 0 ] || [[ "${TA_STATUS,,}" == "skipped" ]]; then
    log_success "DispatchAlert correctly skipped/absent (count: ${TA_COUNT}, status: ${TA_STATUS:-N/A})"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "DispatchAlert should be skipped when ENABLE_ALERT_GENERATION=false (status: ${TA_STATUS})"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  log_warning "jq not available, skipping alert step absence verification"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
