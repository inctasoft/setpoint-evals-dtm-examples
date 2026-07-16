#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 07: Variant Selection + Outcome Rules
# ═══════════════════════════════════════════════════════════════════════════
# Tests the workflow.controller.ts variant-resolution mechanics for
# order-processing — NOT the quick-order DAG shape itself (SE-05 already
# covers "no fan-out/discovery steps present").
#
#   (a) explicit variant="quick-order"      -> accepted, runs the 4-step DAG
#   (b) variant omitted                     -> resolves to the DEFAULT
#                                               variant ("default", not
#                                               quick-order) — proven by the
#                                               presence of DiscoverLineItems,
#                                               a step quick-order never creates
#   (c) variant="nonexistent-variant"       -> HTTP 400, BadRequestException
#                                               naming both real variants
#
# Dedicated to Katherine Johnson's order (customer_id=10, order_id=10) — own
# rows, isolated from every other SE — see ../../source-db/SEED-REGISTRY.md.
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

EVAL_NAME="SE 07: Variant Selection + Outcome Rules"
EVAL_PURPOSE="Explicit quick-order / omitted-defaults-to-default / invalid-variant-400"

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

PASS_COUNT=0
FAIL_COUNT=0

# ═══════════════════════════════════════════════════════════════════════════
# Sub-test (a): explicit variant="quick-order" -> accepted, 4-step DAG
# ═══════════════════════════════════════════════════════════════════════════

log_section "SUB-TEST A: explicit quick-order variant"

PAYLOAD_A='{
  "variant": "quick-order",
  "enableDeduplication": false,
  "payload": {
    "customerId": 10,
    "orderId": 10,
    "entityId": "katherine-johnson-explicit"
  },
  "testOptions": {
    "ValidateCustomer": { "simDelay": 300 },
    "SubmitCustomer":   { "simDelay": 300, "ackDelay": 1000 },
    "ValidateOrder":    { "simDelay": 300 },
    "SubmitOrder":      { "simDelay": 300, "ackDelay": 1000 }
  }
}'

IFS=':' read -r JOB_ID_A CORRELATION_ID_A <<< "$(initiate_job "$PAYLOAD_A")"
validate_job_id "$JOB_ID_A" || exit 1
poll_job "$JOB_ID_A" 90 3

JOB_A_JSON=$(get_job_status "$JOB_ID_A")
JOB_A_TYPE=$(echo "$JOB_A_JSON" | jq -r '.type')
JOB_A_STATUS=$(echo "$JOB_A_JSON" | jq -r '.status')

if [ "$JOB_A_TYPE" == "quick-order" ]; then
  log_success "Job A resolved type='quick-order' (explicit)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Job A type mismatch. Expected 'quick-order', got '$JOB_A_TYPE'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if [ "$JOB_A_STATUS" == "completed" ]; then
  log_success "Job A reached COMPLETED"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Job A expected COMPLETED, got '$JOB_A_STATUS'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

DISCOVER_COUNT_A=$(echo "$JOB_A_JSON" | jq '[.steps[] | select(.stepNumber == "DiscoverLineItems")] | length')
if [ "$DISCOVER_COUNT_A" -eq 0 ]; then
  log_success "Job A has no DiscoverLineItems step (quick-order DAG confirmed)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Job A unexpectedly has a DiscoverLineItems step"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Sub-test (b): variant omitted -> resolves to "default", NOT quick-order
# ═══════════════════════════════════════════════════════════════════════════

log_section "SUB-TEST B: omitted variant resolves to 'default'"

PAYLOAD_B='{
  "enableDeduplication": false,
  "payload": {
    "customerId": 10,
    "orderId": 10,
    "productId": 1,
    "paymentId": 10,
    "shipmentId": 10,
    "entityId": "katherine-johnson-omitted"
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

IFS=':' read -r JOB_ID_B CORRELATION_ID_B <<< "$(initiate_job "$PAYLOAD_B")"
validate_job_id "$JOB_ID_B" || exit 1
# Order 10 intentionally has NO payment/shipment rows (SE-07's own dedicated
# quick-order-shaped rows) — ValidatePayment/ValidateShipment fail naturally
# (not-found), driving the optional cascades to PARTIAL_SUCCESS. That's not
# what this sub-test is verifying (SE-04/SE-09 already own that behavior);
# it's only used here as a REAL default-DAG job that reaches a terminal state.
poll_job "$JOB_ID_B" 150 3

JOB_B_JSON=$(get_job_status "$JOB_ID_B")
JOB_B_TYPE=$(echo "$JOB_B_JSON" | jq -r '.type')
JOB_B_STATUS=$(echo "$JOB_B_JSON" | jq -r '.status')

if [ "$JOB_B_TYPE" == "default" ]; then
  log_success "Job B resolved type='default' (omitted -> default, NOT quick-order)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Job B type mismatch. Expected 'default', got '$JOB_B_TYPE'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if [ "$JOB_B_STATUS" == "completed" ] || [ "$JOB_B_STATUS" == "partial_success" ]; then
  log_success "Job B reached a terminal success-family status ($JOB_B_STATUS)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Job B expected completed/partial_success, got '$JOB_B_STATUS'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

DISCOVER_COUNT_B=$(echo "$JOB_B_JSON" | jq '[.steps[] | select(.stepNumber == "DiscoverLineItems")] | length')
if [ "$DISCOVER_COUNT_B" -ge 1 ]; then
  log_success "Job B has a DiscoverLineItems step (default DAG confirmed, not quick-order)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Job B is missing DiscoverLineItems — looks like quick-order, not default"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Sub-test (c): variant="nonexistent-variant" -> HTTP 400
# ═══════════════════════════════════════════════════════════════════════════

log_section "SUB-TEST C: nonexistent variant -> HTTP 400"

PAYLOAD_C='{
  "variant": "nonexistent-variant",
  "enableDeduplication": false,
  "payload": {
    "customerId": 10,
    "orderId": 10,
    "entityId": "katherine-johnson-bad-variant"
  }
}'

RESPONSE_C=$(curl -s -w "\n%{http_code}" -X POST \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_C")
HTTP_CODE_C=$(echo "$RESPONSE_C" | tail -n1)
BODY_C=$(echo "$RESPONSE_C" | sed '$d')

if [ "$HTTP_CODE_C" == "400" ]; then
  log_success "Nonexistent variant rejected with HTTP 400"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected HTTP 400 for nonexistent variant, got $HTTP_CODE_C"
  echo "   Response: $BODY_C"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if echo "$BODY_C" | jq -r '.message' | grep -q "Available variants: \[default, quick-order\]"; then
  log_success "Error message names both real variants (default, quick-order)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Error message did not name the available variants as expected"
  echo "   Response: $BODY_C"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
