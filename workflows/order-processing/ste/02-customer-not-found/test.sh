#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# STE 02: Customer Not Found
# ═══════════════════════════════════════════════════════════════════════════
# Tests error handling when initiating a job for a non-existent customer.
#
# Expected behavior:
#   1. ValidateCustomer step fails (customer not in source DB)
#   2. Customer is a CRITICAL entity (criticality: "required")
#   3. Outcome rule "critical-entity-failed" fires
#   4. Job reaches FAILED status
#   5. Downstream steps (SubmitCustomer, ValidateOrder, etc.) do NOT execute
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="STE 02: Customer Not Found"
EVAL_PURPOSE="Test failure handling when critical entity (customer) does not exist"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: customer-99999 (does NOT exist in source DB)"
log_info "Variant: default"
log_info "Expected Outcome: Job FAILS (critical entity failed)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with Non-Existent Customer
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (NON-EXISTENT CUSTOMER)"

PAYLOAD='{
  "variant": "default",
  "payload": {
    "customerId": 99999,
    "productId": 1,
    "entityId": "customer-99999"
  },
  "testOptions": {
    "ValidateCustomer":    { "simDelay": 300 },
    "ValidateProduct":     { "simDelay": 300 },
    "SubmitCustomer":      { "simDelay": 300, "ackDelay": 1000 },
    "ValidateOrder":       { "simDelay": 300 },
    "SubmitOrder":         { "simDelay": 300, "ackDelay": 1000 }
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

# Test 2: ValidateCustomer should be FAILED
if verify_step_status "$JOB_ID" "ValidateCustomer" "FAILED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: SubmitCustomer should NOT be COMPLETED (dependency failed)
FINAL_STATUS_JSON=$(get_job_status "$JOB_ID")
TC_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "SubmitCustomer")

if [[ "${TC_STATUS,,}" != "completed" ]]; then
  log_success "SubmitCustomer correctly NOT completed (status: ${TC_STATUS})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "SubmitCustomer should NOT be completed when ValidateCustomer fails"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: ValidateOrder should NOT be COMPLETED (depends on ValidateCustomer)
EO_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "ValidateOrder")

if [[ "${EO_STATUS,,}" != "completed" ]]; then
  log_success "ValidateOrder correctly NOT completed (status: ${EO_STATUS})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "ValidateOrder should NOT be completed when ValidateCustomer fails"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
