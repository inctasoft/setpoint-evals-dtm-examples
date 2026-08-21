#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 08: Per-Request Deduplication
# ═══════════════════════════════════════════════════════════════════════════
# Tests the generic workflow endpoint's per-request deduplication, per
# docs/guides/PER-REQUEST-DEDUPLICATION.md: testOptions.enableDeduplication
# is a PER-REQUEST override that works regardless of the global
# ENABLE_DEDUPLICATION env var (which stays false in dev).
#
#   1. First request (deduplicationKey=<fresh UUID>, enableDeduplication:true)
#      -> HTTP 201, a real job is created
#   2. Second, IDENTICAL request (same key) -> HTTP 409 Conflict; body's
#      existingJobId equals the first job's id -- no second job is created
#   3. A DIFFERENT deduplicationKey -> HTTP 201 (dedup is key-scoped, not a
#      blanket lock on the endpoint)
#
# Dedicated to Hedy Lamarr's order (customer_id=11, order_id=11) -- own rows,
# isolated from every other SE -- see ../../source-db/SEED-REGISTRY.md.
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

EVAL_NAME="SE 08: Per-Request Deduplication"
EVAL_PURPOSE="2nd identical request deduped (409); different key still accepted (201)"

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

PASS_COUNT=0
FAIL_COUNT=0

DEDUP_KEY_1=$(uuidgen)
DEDUP_KEY_2=$(uuidgen)
log_info "Deduplication Key 1: $DEDUP_KEY_1"
log_info "Deduplication Key 2: $DEDUP_KEY_2"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: First request -> should succeed (201)
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: FIRST REQUEST (SHOULD SUCCEED)"

PAYLOAD_1=$(cat <<EOF
{
  "deduplicationKey": "$DEDUP_KEY_1",
  "variant": "quick-order",
  "enableDeduplication": true,
  "payload": {
    "customerId": 11,
    "orderId": 11,
    "entityId": "$DEDUP_KEY_1"
  },
  "testOptions": {
    "ValidateCustomer": { "simDelay": 1000 },
    "SubmitCustomer":   { "simDelay": 1000, "ackDelay": 500 },
    "ValidateOrder":    { "simDelay": 1000 },
    "SubmitOrder":      { "simDelay": 1000, "ackDelay": 500 }
  }
}
EOF
)

RESPONSE_1=$(curl -s -w "\n%{http_code}" -X POST \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" -d "$PAYLOAD_1")
HTTP_CODE_1=$(echo "$RESPONSE_1" | tail -n1)
BODY_1=$(echo "$RESPONSE_1" | sed '$d')

if [ "$HTTP_CODE_1" == "201" ]; then
  log_success "First request accepted (201)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected HTTP 201, got $HTTP_CODE_1 — $BODY_1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
fi

JOB_ID_1=$(echo "$BODY_1" | jq -r '.jobId')
log_info "Job ID: $JOB_ID_1"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Identical request -> should be deduped (409), no second job made
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 2: IDENTICAL REQUEST (SHOULD DEDUPE)"

RESPONSE_2=$(curl -s -w "\n%{http_code}" -X POST \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" -d "$PAYLOAD_1")
HTTP_CODE_2=$(echo "$RESPONSE_2" | tail -n1)
BODY_2=$(echo "$RESPONSE_2" | sed '$d')

if [ "$HTTP_CODE_2" == "409" ]; then
  log_success "Duplicate request rejected (409)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected HTTP 409, got $HTTP_CODE_2 — $BODY_2"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

EXISTING_JOB_ID=$(echo "$BODY_2" | jq -r '.details.existingJobId // .existingJobId // empty')
if [ "$EXISTING_JOB_ID" == "$JOB_ID_1" ]; then
  log_success "409 body's existingJobId matches the first job ($JOB_ID_1) — no second job created"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "existingJobId mismatch. Expected '$JOB_ID_1', got '$EXISTING_JOB_ID'"
  echo "   Response: $BODY_2"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 3: A DIFFERENT deduplicationKey -> should still succeed (201)
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 3: DIFFERENT KEY (SHOULD SUCCEED — DEDUP IS KEY-SCOPED)"

PAYLOAD_2=$(cat <<EOF
{
  "deduplicationKey": "$DEDUP_KEY_2",
  "variant": "quick-order",
  "enableDeduplication": true,
  "payload": {
    "customerId": 11,
    "orderId": 11,
    "entityId": "$DEDUP_KEY_2"
  },
  "testOptions": {
    "ValidateCustomer": { "simDelay": 300 },
    "SubmitCustomer":   { "simDelay": 300, "ackDelay": 500 },
    "ValidateOrder":    { "simDelay": 300 },
    "SubmitOrder":      { "simDelay": 300, "ackDelay": 500 }
  }
}
EOF
)

RESPONSE_3=$(curl -s -w "\n%{http_code}" -X POST \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" -d "$PAYLOAD_2")
HTTP_CODE_3=$(echo "$RESPONSE_3" | tail -n1)
BODY_3=$(echo "$RESPONSE_3" | sed '$d')

if [ "$HTTP_CODE_3" == "201" ]; then
  log_success "Different deduplicationKey accepted (201) — dedup is key-scoped, not a blanket lock"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected HTTP 201, got $HTTP_CODE_3 — $BODY_3"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

JOB_ID_2=$(echo "$BODY_3" | jq -r '.jobId // empty')
if [ -n "$JOB_ID_2" ] && [ "$JOB_ID_2" != "$JOB_ID_1" ]; then
  log_success "Second job ($JOB_ID_2) is a distinct job from the first ($JOB_ID_1)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected a distinct jobId, got '$JOB_ID_2'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# Drain both real jobs so the stack doesn't carry stragglers into later SEs.
[ -n "$JOB_ID_1" ] && poll_job "$JOB_ID_1" 60 3 >/dev/null 2>&1 || true
[ -n "$JOB_ID_2" ] && poll_job "$JOB_ID_2" 60 3 >/dev/null 2>&1 || true

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
