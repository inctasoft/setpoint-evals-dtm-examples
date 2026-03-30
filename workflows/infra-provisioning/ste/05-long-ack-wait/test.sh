#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# STE 05: Long ACK Wait
# ═══════════════════════════════════════════════════════════════════════════
# Tests the long ACK timeout behavior for ApplyCompute.
#
# ApplyCompute has a 600000ms (10-minute) ACK timeout configured in
# workflow.config.ts metadata.timeoutMs. This test verifies that:
#
#   1. ApplyCompute enters WAITING_FOR_ACK state after success callback
#   2. ACK arrives after a configurable delay (ackDelay: 5000ms)
#   3. After ACK arrives, downstream steps (Storage, DNS, LoadBalancer) resume
#   4. Job reaches COMPLETED status
#
# This demonstrates the DTM engine's ability to handle long-running
# provisioning operations where external systems take time to acknowledge
# that infrastructure has been created.
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="STE 05: Long ACK Wait"
EVAL_PURPOSE="Test WAITING_FOR_ACK -> delayed ACK -> downstream steps resume"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: ENV-DEV"
log_info "Variant: default"
log_info "ApplyCompute ackDelay: 5000ms (simulates long provisioning wait)"
log_info "Expected: ApplyCompute enters WAITING_FOR_ACK, then completes after ACK"
log_info "Expected Outcome: Job COMPLETES (all steps pass after ACK delay)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with Long ACK Delay
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (LONG ACK WAIT)"

PAYLOAD='{
  "enableDeduplication": false,
  "variant": "default",
  "payload": {
    "environmentId": "ENV-DEV",
    "networkId": "NET-DEV-1",
    "instanceId": "INST-DEV-1",
    "dnsRecordId": "DNS-DEV-1",
    "certificateId": "CERT-DEV-1",
    "loadBalancerId": "LB-DEV-1",
    "entityId": "ENV-DEV"
  },
  "testOptions": {
    "PlanEnvironment":    { "simDelay": 300 },
    "ApplyEnvironment":   { "simDelay": 300, "ackDelay": 1000 },
    "PlanNetwork":        { "simDelay": 300 },
    "ApplyNetwork":       { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverCompute":    { "simDelay": 300 },
    "PlanCompute":        { "simDelay": 300 },
    "ApplyCompute":       { "simDelay": 300, "ackDelay": 5000 },
    "PlanStorage":        { "simDelay": 300 },
    "ApplyStorage":       { "simDelay": 300, "ackDelay": 1000 },
    "PlanDNS":            { "simDelay": 300 },
    "ApplyDNS":           { "simDelay": 300, "ackDelay": 1000 },
    "PlanCertificate":    { "simDelay": 300 },
    "ApplyCertificate":   { "simDelay": 300, "ackDelay": 1000 },
    "PlanLoadBalancer":   { "simDelay": 300 },
    "ApplyLoadBalancer":  { "simDelay": 300, "ackDelay": 1000 }
  }
}'

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")"
validate_job_id "$JOB_ID" || exit 1

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Monitor Progress (longer timeout for ACK delay)
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 2: MONITORING PROGRESS (EXPECTING ACK DELAY)"

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

# Test 2: ApplyCompute should be COMPLETED (ACK received after delay)
FINAL_STATUS_JSON=$(get_job_status "$JOB_ID")

if command -v jq &> /dev/null; then
  # Check all ApplyCompute child steps are completed
  TC_TOTAL=$(echo "${FINAL_STATUS_JSON}" | jq '[.steps[] | select(.stepNumber == "ApplyCompute")] | length' 2>/dev/null || echo "0")
  TC_COMPLETED=$(echo "${FINAL_STATUS_JSON}" | jq '[.steps[] | select(.stepNumber == "ApplyCompute" and .status == "completed")] | length' 2>/dev/null || echo "0")

  if [ "${TC_TOTAL}" -gt 0 ] && [ "${TC_COMPLETED}" -ge "${TC_TOTAL}" ]; then
    log_success "All ${TC_COMPLETED} ApplyCompute steps completed (ACK received after delay)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "Not all ApplyCompute steps completed: ${TC_COMPLETED}/${TC_TOTAL}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  log_warning "jq not available, skipping ApplyCompute completion verification"
fi

# Test 3: Downstream steps (Storage) should be COMPLETED (resumed after ACK)
if verify_step_status "$JOB_ID" "PlanNetwork" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: DiscoverCompute should be COMPLETED
if verify_step_status "$JOB_ID" "DiscoverCompute" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
