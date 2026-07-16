#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 09: Optional vs Required Cascade Boundary
# ═══════════════════════════════════════════════════════════════════════════
# Pins CRITICALITY_RULES / OUTCOME_RULES in workflow.config.ts directly, via
# FORCED failures (testOptions.failOnAttempts), not the not-found-sentinel
# trick SE-04 already owns:
#
#   Part A (optional cascade fails): order_id=13 (Mary Jackson), default
#     variant, healthy customer/order/payment/shipment, but ValidateLineItem
#     forced to fail on every attempt for both of order 13's line items.
#     lineItem is an OPTIONAL cascade -> job reaches PARTIAL_SUCCESS.
#
#   Part B (required cascade fails): order_id=12 (Dorothy Vaughan),
#     quick-order variant, SubmitOrder forced to fail on every attempt.
#     order is a REQUIRED cascade -> job reaches FAILED.
#
# Dedicated rows -- see ../../source-db/SEED-REGISTRY.md.
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

EVAL_NAME="SE 09: Optional vs Required Cascade Boundary"
EVAL_PURPOSE="optional (lineItem) fails -> PARTIAL_SUCCESS; required (order) fails -> FAILED"

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

PASS_COUNT=0
FAIL_COUNT=0

# ═══════════════════════════════════════════════════════════════════════════
# Part A: optional cascade (lineItem) fails -> PARTIAL_SUCCESS
# ═══════════════════════════════════════════════════════════════════════════

log_section "PART A: optional cascade (lineItem) forced failure"

PAYLOAD_A='{
  "variant": "default",
  "enableDeduplication": false,
  "payload": {
    "customerId": 13,
    "orderId": 13,
    "productId": 1,
    "paymentId": 13,
    "shipmentId": 13,
    "entityId": "mary-jackson-optional-cascade"
  },
  "testOptions": {
    "ValidateCustomer":    { "simDelay": 300 },
    "ValidateProduct":     { "simDelay": 300 },
    "SubmitCustomer":      { "simDelay": 300, "ackDelay": 1000 },
    "ValidateOrder":       { "simDelay": 300 },
    "SubmitOrder":         { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverLineItems":   { "simDelay": 300 },
    "ValidateLineItem":    { "simDelay": 300, "failOnAttempts": [1, 2, 3] },
    "SubmitLineItem":      { "simDelay": 300, "ackDelay": 1000 },
    "ValidatePayment":     { "simDelay": 300 },
    "SubmitPayment":       { "simDelay": 300, "ackDelay": 1000 },
    "ValidateShipment":    { "simDelay": 300 },
    "SubmitShipment":      { "simDelay": 300, "ackDelay": 1000 }
  }
}'

IFS=':' read -r JOB_ID_A CORRELATION_ID_A <<< "$(initiate_job "$PAYLOAD_A")"
validate_job_id "$JOB_ID_A" || exit 1
poll_job "$JOB_ID_A" 300 5

JOB_A_JSON=$(get_job_status "$JOB_ID_A")
JOB_A_STATUS=$(echo "$JOB_A_JSON" | jq -r '.status')

if [ "$JOB_A_STATUS" == "partial_success" ]; then
  log_success "Part A: job reached PARTIAL_SUCCESS (optional cascade failure)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part A: expected partial_success, got '$JOB_A_STATUS'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID_A" "SubmitCustomer" "COMPLETED" && \
   verify_step_status "$JOB_ID_A" "SubmitOrder" "COMPLETED" && \
   verify_step_status "$JOB_ID_A" "SubmitPayment" "COMPLETED" && \
   verify_step_status "$JOB_ID_A" "SubmitShipment" "COMPLETED"; then
  log_success "Part A: required cascades (customer/order) and the other optional cascades (payment/shipment) still COMPLETED"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part A: unexpected status among the healthy cascades"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

FAILED_LINE_ITEMS_A=$(echo "$JOB_A_JSON" | jq '[.steps[] | select(.stepNumber == "ValidateLineItem" and .status == "failed")] | length')
if [ "$FAILED_LINE_ITEMS_A" -ge 1 ]; then
  log_success "Part A: ValidateLineItem failed as forced ($FAILED_LINE_ITEMS_A failure(s))"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part A: expected ValidateLineItem to have failed, found $FAILED_LINE_ITEMS_A"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Part B: required cascade (order) fails -> FAILED
# ═══════════════════════════════════════════════════════════════════════════

log_section "PART B: required cascade (order) forced failure"

PAYLOAD_B='{
  "variant": "quick-order",
  "enableDeduplication": false,
  "payload": {
    "customerId": 12,
    "orderId": 12,
    "entityId": "dorothy-vaughan-required-cascade"
  },
  "testOptions": {
    "ValidateCustomer": { "simDelay": 300 },
    "SubmitCustomer":   { "simDelay": 300, "ackDelay": 1000 },
    "ValidateOrder":    { "simDelay": 300 },
    "SubmitOrder":      { "simDelay": 300, "failOnAttempts": [1, 2, 3] }
  }
}'

IFS=':' read -r JOB_ID_B CORRELATION_ID_B <<< "$(initiate_job "$PAYLOAD_B")"
validate_job_id "$JOB_ID_B" || exit 1
poll_job "$JOB_ID_B" 200 5

JOB_B_JSON=$(get_job_status "$JOB_ID_B")
JOB_B_STATUS=$(echo "$JOB_B_JSON" | jq -r '.status')

if [ "$JOB_B_STATUS" == "failed" ]; then
  log_success "Part B: job reached FAILED (required cascade failure)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part B: expected failed, got '$JOB_B_STATUS'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID_B" "SubmitOrder" "FAILED"; then
  log_success "Part B: SubmitOrder is FAILED as forced"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part B: expected SubmitOrder FAILED"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID_B" "ValidateCustomer" "COMPLETED" && \
   verify_step_status "$JOB_ID_B" "SubmitCustomer" "COMPLETED" && \
   verify_step_status "$JOB_ID_B" "ValidateOrder" "COMPLETED"; then
  log_success "Part B: everything upstream of the forced failure still COMPLETED"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part B: unexpected status among the upstream steps"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
