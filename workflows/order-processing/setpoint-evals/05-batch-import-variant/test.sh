#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 05: Quick Order Variant
# ═══════════════════════════════════════════════════════════════════════════
# Tests the "quick-order" workflow variant — a simplified flow without
# fan-out, discovery, or optional entities.
#
# Quick-order variant steps:
#   ValidateCustomer -> SubmitCustomer -> ValidateOrder -> SubmitOrder
#
# No DiscoverLineItems, no ValidateLineItem/SubmitLineItem,
# no Payment, no Shipment, no Product.
#
# Expected behavior:
#   1. Only 4 steps execute (VC, SC, VO, SO)
#   2. All 4 complete successfully
#   3. Job reaches COMPLETED status
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 05: Quick Order Variant"
EVAL_PURPOSE="Test simplified quick-order variant (no fan-out, no discovery)"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: customer-1000"
log_info "Variant: quick-order"
log_info "Expected Steps: ValidateCustomer, SubmitCustomer, ValidateOrder, SubmitOrder"
log_info "Expected Outcome: Job COMPLETES (simplified flow)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with quick-order Variant
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (QUICK-ORDER VARIANT)"

PAYLOAD='{
  "enableDeduplication": false,
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "customer-1000"
  },
  "testOptions": {
    "ValidateCustomer":  { "simDelay": 300 },
    "SubmitCustomer":    { "simDelay": 300, "ackDelay": 1000 },
    "ValidateOrder":     { "simDelay": 300 },
    "SubmitOrder":       { "simDelay": 300, "ackDelay": 1000 }
  }
}'

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")"
validate_job_id "$JOB_ID" || exit 1

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Monitor Progress
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 2: MONITORING PROGRESS"

poll_job "$JOB_ID" 60 3

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

# Test 3: SubmitCustomer should be COMPLETED
if verify_step_status "$JOB_ID" "SubmitCustomer" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: ValidateOrder should be COMPLETED
if verify_step_status "$JOB_ID" "ValidateOrder" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 5: SubmitOrder should be COMPLETED
if verify_step_status "$JOB_ID" "SubmitOrder" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 6: No fan-out steps should exist (quick-order has no discovery)
JOB_DETAILS=$(get_job_status "$JOB_ID")

if command -v jq &> /dev/null; then
  DISCOVER_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "DiscoverLineItems")] | length' 2>/dev/null || echo "0")
  VALIDATE_ITEM_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "ValidateLineItem")] | length' 2>/dev/null || echo "0")
  PAYMENT_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "ValidatePayment")] | length' 2>/dev/null || echo "0")
  SHIPMENT_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "ValidateShipment")] | length' 2>/dev/null || echo "0")
  PRODUCT_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "ValidateProduct")] | length' 2>/dev/null || echo "0")

  if [ "${DISCOVER_COUNT}" -eq 0 ] && [ "${VALIDATE_ITEM_COUNT}" -eq 0 ] && \
     [ "${PAYMENT_COUNT}" -eq 0 ] && [ "${SHIPMENT_COUNT}" -eq 0 ] && \
     [ "${PRODUCT_COUNT}" -eq 0 ]; then
    log_success "No fan-out/discovery/optional steps present (quick-order variant confirmed)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "Unexpected steps found in quick-order variant:"
    log_error "  DiscoverLineItems: ${DISCOVER_COUNT}, ValidateLineItem: ${VALIDATE_ITEM_COUNT}"
    log_error "  ValidatePayment: ${PAYMENT_COUNT}, ValidateShipment: ${SHIPMENT_COUNT}"
    log_error "  ValidateProduct: ${PRODUCT_COUNT}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  log_warning "jq not available, skipping fan-out absence verification"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
