#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 01: Happy Path
# ═══════════════════════════════════════════════════════════════════════════
# Verifies the standard end-to-end order-processing flow:
#   1. Initiate a job with payload.entityId="customer-1" (mapped to customer_id=1)
#   2. All validate/submit steps complete successfully
#   3. Job reaches COMPLETED status
#
# Uses the "default" variant (full fan-out workflow with all entities).
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 01: Happy Path"
EVAL_PURPOSE="Test standard successful order-processing with default variant"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: customer-1"
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
    "customerId": 1,
    "productId": 1,
    "orderId": 1,
    "orderItemId": 1,
    "paymentId": 1,
    "shipmentId": 1,
    "entityId": "customer-1"
  },
  "testOptions": {
    "ValidateCustomer":    { "simDelay": 300 },
    "ValidateProduct":     { "simDelay": 300 },
    "SubmitCustomer":      { "simDelay": 300, "ackDelay": 1000 },
    "ValidateOrder":       { "simDelay": 300 },
    "SubmitOrder":         { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverLineItems":   { "simDelay": 300 },
    "ValidateLineItem":    { "simDelay": 300 },
    "SubmitLineItem":      { "simDelay": 300, "ackDelay": 1000 },
    "ValidatePayment":     { "simDelay": 300 },
    "SubmitPayment":       { "simDelay": 300, "ackDelay": 1000 },
    "ValidateShipment":    { "simDelay": 300 },
    "SubmitShipment":      { "simDelay": 300, "ackDelay": 1000 }
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

# Test 2: ValidateCustomer should be COMPLETED
if verify_step_status "$JOB_ID" "ValidateCustomer" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: ValidateProduct should be COMPLETED
if verify_step_status "$JOB_ID" "ValidateProduct" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: SubmitCustomer should be COMPLETED
if verify_step_status "$JOB_ID" "SubmitCustomer" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 5: ValidateOrder should be COMPLETED
if verify_step_status "$JOB_ID" "ValidateOrder" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 6: SubmitOrder should be COMPLETED
if verify_step_status "$JOB_ID" "SubmitOrder" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
