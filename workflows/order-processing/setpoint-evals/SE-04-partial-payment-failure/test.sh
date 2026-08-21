#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 04: Partial Payment Failure
# ═══════════════════════════════════════════════════════════════════════════
# Tests that payment failure results in PARTIAL_SUCCESS (not FAILED).
#
# In the order-processing workflow:
#   - Customer and Order are CRITICAL entities (criticality: "required")
#   - Payment is an OPTIONAL entity (criticality: "optional")
#
# Dedicated to Barbara Liskov's order (customer_id=7, order_id=7) at Ada's
# Beans Cafe — order 7 has line items and a real shipment, but ZERO payment
# rows: the beans left the roastery before the card finished processing.
# Own rows, isolated from every other SE — see ../../source-db/SEED-REGISTRY.md.
#
# Expected behavior:
#   1. ValidateCustomer, ValidateProduct, SubmitCustomer, ValidateOrder,
#      SubmitOrder all succeed (critical entities)
#   2. ValidatePayment fails (paymentId 99999 sentinel — matches no order_id)
#   3. SubmitPayment is SKIPPED (dependency ValidatePayment failed)
#   4. Outcome rule fires for optional entity failure
#   5. Job reaches PARTIAL_SUCCESS status
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 04: Partial Payment Failure"
EVAL_PURPOSE="Test optional entity failure results in PARTIAL_SUCCESS"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: barbara-liskov (customer_id=7, order_id=7)"
log_info "Variant: default"
log_info "ValidatePayment configured with the not-found sentinel paymentId (99999)"
log_info "Expected Outcome: PARTIAL_SUCCESS (payment is optional)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with SubmitPayment Failure
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (PAYMENT FAILURE)"

PAYLOAD='{
  "enableDeduplication": false,
  "variant": "default",
  "payload": {
    "customerId": 7,
    "productId": 1,
    "orderId": 7,
    "paymentId": 99999,
    "shipmentId": 7,
    "entityId": "barbara-liskov"
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

# Test 1: Job status should be PARTIAL_SUCCESS
if verify_job_status "$JOB_ID" "PARTIAL_SUCCESS"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 2: Critical entity steps should be COMPLETED
if verify_step_status "$JOB_ID" "ValidateCustomer" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "SubmitCustomer" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "ValidateOrder" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "SubmitOrder" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: ValidatePayment should be FAILED (non-existent paymentId)
if verify_step_status "$JOB_ID" "ValidatePayment" "FAILED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: SubmitPayment should be SKIPPED (dependency ValidatePayment failed)
if verify_step_status "$JOB_ID" "SubmitPayment" "SKIPPED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 5: ArchiveProcessedOrder should ALSO be SKIPPED — SubmitPayment is one
# of its hard dependencies (workflow.config.ts), and a SKIPPED dependency
# never satisfies a downstream step. Pins the README mermaid diagram's claim
# (previously wrong — it showed Archive unblocked) to executable behavior.
if verify_step_status "$JOB_ID" "ArchiveProcessedOrder" "SKIPPED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
