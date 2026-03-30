#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# STE 03: Fan-Out Line Items
# ═══════════════════════════════════════════════════════════════════════════
# Tests the Discovery + Fan-Out pattern for line items.
#
# Flow:
#   ValidateCustomer (root) -> SubmitCustomer -> ValidateOrder
#   -> DiscoverLineItems -> N x (ValidateLineItem -> SubmitLineItem)
#
# Customer 1 (customer_id=1) has orders 1 and 3.
# Order 1 has items: 1, 2, 16 (3 items after seed cleanup)
# Order 3 has items: 5, 6, 8, 9, 24 (5 items after seed cleanup)
#
# This test sends an orderId that maps to order 1, which has 3 items,
# or we use customer-1000 with an orderId payload to trigger 5+ items.
#
# We verify:
#   1. DiscoverLineItems completes and spawns child steps
#   2. Multiple ValidateLineItem child steps are created
#   3. Multiple SubmitLineItem child steps are created
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

EVAL_NAME="STE 03: Fan-Out Line Items"
EVAL_PURPOSE="Test Discovery + Fan-Out pattern creating multiple child steps"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: customer-1000"
log_info "Variant: default (includes fan-out)"
log_info "Payload includes orderId targeting order with 5+ items"
log_info "Expected Outcome: Fan-out creates multiple child steps, job COMPLETES"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with Order Having Multiple Items
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (FAN-OUT SCENARIO)"

PAYLOAD='{
  "variant": "default",
  "orderId": "order-4",
  "payload": {
    "customerId": 1,
    "productId": 1,
    "orderId": 1,
    "paymentId": 1,
    "shipmentId": 1,
    "entityId": "customer-1000"
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

# Test 2: DiscoverLineItems should be COMPLETED
if verify_step_status "$JOB_ID" "DiscoverLineItems" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 5: Fan-Out Pattern Verification
# ═══════════════════════════════════════════════════════════════════════════

log_section "FAN-OUT PATTERN VERIFICATION"

JOB_DETAILS=$(get_job_status "$JOB_ID")

# Count ValidateLineItem child steps
VALIDATE_ITEM_COUNT=0
SUBMIT_ITEM_COUNT=0

if command -v jq &> /dev/null; then
  VALIDATE_ITEM_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "ValidateLineItem")] | length' 2>/dev/null || echo "0")
  SUBMIT_ITEM_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "SubmitLineItem")] | length' 2>/dev/null || echo "0")
fi

log_info "ValidateLineItem child steps: ${VALIDATE_ITEM_COUNT}"
log_info "SubmitLineItem child steps: ${SUBMIT_ITEM_COUNT}"

# Test 3: At least 1 ValidateLineItem child step should exist
if [ "${VALIDATE_ITEM_COUNT}" -gt 0 ]; then
  log_success "ValidateLineItem child steps created: ${VALIDATE_ITEM_COUNT}"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "No ValidateLineItem child steps found - fan-out not creating children!"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: At least 1 SubmitLineItem child step should exist
if [ "${SUBMIT_ITEM_COUNT}" -gt 0 ]; then
  log_success "SubmitLineItem child steps created: ${SUBMIT_ITEM_COUNT}"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "No SubmitLineItem child steps found - fan-out chain not working!"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 5: Verify all SubmitLineItem steps completed (with retry for race condition)
if [ "${SUBMIT_ITEM_COUNT}" -gt 0 ] && command -v jq &> /dev/null; then
  log_info "Waiting for SubmitLineItem steps to complete (with retry)..."

  MAX_STEP_VERIFY_ATTEMPTS=15
  STEP_VERIFY_PASSED=false

  for step_attempt in $(seq 1 $MAX_STEP_VERIFY_ATTEMPTS); do
    JOB_DETAILS=$(get_job_status "$JOB_ID")
    SUBMIT_ITEM_COMPLETED=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "SubmitLineItem" and .status == "completed")] | length')

    if [ "${SUBMIT_ITEM_COMPLETED}" -ge "${SUBMIT_ITEM_COUNT}" ]; then
      log_success "All ${SUBMIT_ITEM_COMPLETED} SubmitLineItem steps completed"
      PASS_COUNT=$((PASS_COUNT + 1))
      STEP_VERIFY_PASSED=true
      break
    fi

    if [ $step_attempt -lt $MAX_STEP_VERIFY_ATTEMPTS ]; then
      log_info "Attempt $step_attempt/$MAX_STEP_VERIFY_ATTEMPTS: SubmitLineItem steps completing (${SUBMIT_ITEM_COMPLETED}/${SUBMIT_ITEM_COUNT})..."
      sleep 1
    fi
  done

  if [ "$STEP_VERIFY_PASSED" = false ]; then
    log_error "Not all SubmitLineItem steps completed: ${SUBMIT_ITEM_COMPLETED}/${SUBMIT_ITEM_COUNT}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
