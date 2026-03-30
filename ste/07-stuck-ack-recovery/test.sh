#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source shared helpers
source "${REPO_ROOT}/workflows/order-processing/ste/shared/helpers.sh"

# Test configuration
# Generate unique identifier for each run (enables multiple runs without conflicts)
EXTERNAL_SYSTEM_ID=$(uuidgen)

MAX_ATTEMPTS=60
POLL_INTERVAL=2
ACK_TIMEOUT_SECONDS=15

###############################################################################
# Test Header
###############################################################################

log_section "Eval 12: Stuck Acknowledgement Recovery"
echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║     Eval 12: Stuck Acknowledgement Recovery                       ║"
echo "╠════════════════════════════════════════════════════════════════════╣"
echo "║ Test maintenance task auto-failing stuck acknowledgements         ║"
echo "║                                                                    ║"
echo "║ NOTE: Due to cascade dependencies, we test SubmitCustomer only ║"
echo "║       SubmitOrder can't reach WAITING_FOR_ACK until TC        ║"
echo "║       has received its ACK (cascade architecture)                 ║"
echo "║                                                                    ║"
echo "║ ✅ NON-DESTRUCTIVE: Uses skipAck instead of killing services     ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
log_info "Expected Duration: ~30-45 seconds"
log_info "Expected Outcome: SubmitCustomer auto-failed, SubmitOrder skipped"
echo ""

###############################################################################
# SCENARIO: SubmitCustomer Stuck (Single Step)
###############################################################################

log_section "STUCK ACK SCENARIO: SubmitCustomer"
echo ""

log_info "This scenario tests:"
log_info "  • SubmitCustomer completes → publishes to Kafka → WAITING_FOR_ACK"
log_info "  • Using skipAck=true to prevent ACK from arriving (non-destructive)"
log_info "  • Result: SubmitCustomer stuck → auto-failed by maintenance task"
log_info "           SubmitOrder → SKIPPED (cascade dependency)"
echo ""
log_info "⚠️  Architecture Note:"
log_info "  SubmitOrder depends on SubmitCustomer's ACK (cascade flow)"
log_info "  Therefore, it can NEVER reach WAITING_FOR_ACK before TC gets its ACK"
log_info "  This is expected behavior - we can only test single step stuck."
echo ""

# KEY CHANGE: Using skipAck instead of killing simulator
PAYLOAD=$(cat <<EOF
{
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "$EXTERNAL_SYSTEM_ID"
  },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500 },
    "ValidateProduct": { "simDelay": 500 },
    "SubmitCustomer": { "simDelay": 500, "skipAck": true },
    "SubmitOrder": { "simDelay": 500, "skipAck": true }
  }
}
EOF
)

log_info "▶  Initiating job..."
log_info "Key setting: SubmitCustomer skipAck=true (ack will never arrive)"

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || exit 1
validate_job_id "$JOB_ID" || exit 1
log_success "Job initiated!"
log_info "Job ID: $JOB_ID"
log_info "Correlation ID: $CORRELATION_ID"
echo ""

log_info "Waiting for SubmitCustomer to reach WAITING_FOR_ACK..."
ATTEMPT=0
TC_WAITING=false

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))

  JOB_STATUS=$(get_job_status "$JOB_ID")

  TC_STATUS=$(echo "$JOB_STATUS" | jq -r '.steps[] | select(.stepNumber=="SubmitCustomer") | .status')
  TO_STATUS=$(echo "$JOB_STATUS" | jq -r '.steps[] | select(.stepNumber=="SubmitOrder") | .status')

  echo "[$ATTEMPT/$MAX_ATTEMPTS] SubmitCustomer: $TC_STATUS | SubmitOrder: $TO_STATUS"

  # Success: SubmitCustomer is waiting for ack (will never arrive due to skipAck=true)
  if [ "$TC_STATUS" = "waiting_for_ack" ]; then
    TC_WAITING=true
    log_success "SubmitCustomer is waiting for acknowledgement (skipAck=true, will never arrive)"
    break
  fi

  # If TC completed, something is wrong with skipAck
  if [ "$TC_STATUS" = "completed" ]; then
    log_error "SubmitCustomer already completed (ack arrived unexpectedly)"
    log_error "skipAck should have prevented this!"
    exit 1
  fi

  sleep $POLL_INTERVAL
done

if [ "$TC_WAITING" = false ]; then
  log_error "SubmitCustomer did not reach WAITING_FOR_ACK state in time"
  exit 1
fi
echo ""

log_info "Waiting ${ACK_TIMEOUT_SECONDS}s for ack to become 'stuck'..."
log_info "(TC will never receive ack due to skipAck=true)"
sleep $ACK_TIMEOUT_SECONDS
log_success "Timeout period elapsed - SubmitCustomer should be stuck"
echo ""

log_info "Triggering maintenance task (with 6 second timeout threshold)..."
TASK_RESULT=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"ackTimeoutMinutes": 0.1}' \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/stuck-acknowledgement/execute")

# Extract HTTP code and response body
HTTP_CODE=$(echo "$TASK_RESULT" | grep "HTTP_CODE:" | cut -d: -f2)
TASK_BODY=$(echo "$TASK_RESULT" | sed '/HTTP_CODE:/d')

if [ "$HTTP_CODE" != "200" ]; then
  log_error "Maintenance task HTTP error: $HTTP_CODE"
  echo "Response: $TASK_BODY"
  exit 1
fi

TASK_SUCCESS=$(echo "$TASK_BODY" | jq -r '.success')
STEPS_FOUND=$(echo "$TASK_BODY" | jq -r '.metrics.stuckStepsFound // 0')
STEPS_FIXED=$(echo "$TASK_BODY" | jq -r '.metrics.autoFixed // 0')

if [ "$TASK_SUCCESS" != "true" ]; then
  log_error "Maintenance task failed"
  echo "Task result: $TASK_BODY"
  echo "Success field: $TASK_SUCCESS"
  exit 1
fi

# We expect at least 1 stuck step (SubmitCustomer)
if [ "$STEPS_FOUND" -lt 1 ]; then
  log_error "Expected at least 1 stuck step, found: $STEPS_FOUND"
  exit 1
fi

if [ "$STEPS_FIXED" -lt 1 ]; then
  log_error "Expected at least 1 step auto-fixed, fixed: $STEPS_FIXED"
  exit 1
fi

log_success "Maintenance task detected and fixed stuck acknowledgement(s)"
log_info "  • Stuck steps found: $STEPS_FOUND"
log_info "  • Steps auto-fixed: $STEPS_FIXED"
echo ""

# Verify step statuses
log_info "Verifying final step statuses..."
JOB_STATUS=$(get_job_status "$JOB_ID")
TC_STATUS=$(echo "$JOB_STATUS" | jq -r '.steps[] | select(.stepNumber=="SubmitCustomer") | .status')
TO_STATUS=$(echo "$JOB_STATUS" | jq -r '.steps[] | select(.stepNumber=="SubmitOrder") | .status')
JOB_OVERALL=$(echo "$JOB_STATUS" | jq -r '.status')

log_info "  SubmitCustomer: $TC_STATUS"
log_info "  SubmitOrder: $TO_STATUS"
log_info "  Job Status: $JOB_OVERALL"
echo ""

# SubmitCustomer should be FAILED (auto-failed by maintenance task)
if [ "$TC_STATUS" != "failed" ]; then
  log_error "Expected SubmitCustomer to be 'failed', got: $TC_STATUS"
  exit 1
fi
log_success "✅ SubmitCustomer is FAILED (auto-failed by maintenance task)"

# SubmitOrder should be SKIPPED (cascade dependency failed)
# It might also be PENDING if the cascade skip hasn't propagated yet
if [ "$TO_STATUS" != "skipped" ] && [ "$TO_STATUS" != "pending" ]; then
  log_error "Expected SubmitOrder to be 'skipped' or 'pending', got: $TO_STATUS"
  exit 1
fi
log_success "✅ SubmitOrder is $TO_STATUS (cascade dependency)"

# Job should be FAILED
if [ "$JOB_OVERALL" != "failed" ]; then
  log_error "Expected Job to be 'failed', got: $JOB_OVERALL"
  exit 1
fi
log_success "✅ Job is FAILED"
echo ""

###############################################################################
# SUCCESS
###############################################################################

log_section "TEST PASSED"
log_success "✅ Stuck acknowledgement recovery test completed successfully"
echo ""
log_info "Summary:"
log_info "  ✅ SubmitCustomer reached WAITING_FOR_ACK"
log_info "  ✅ ACK never arrived (skipAck=true)"
log_info "  ✅ Maintenance task detected stuck step"
log_info "  ✅ SubmitCustomer auto-failed"
log_info "  ✅ SubmitOrder skipped (cascade dependency)"
log_info "  ✅ Job marked as failed"
log_info "  ✅ No services killed - fully non-destructive test!"
echo ""
log_info "Architecture Note:"
log_info "  Due to cascade dependencies (TO depends on TC ACK),"
log_info "  testing 'both steps stuck' is impossible."
log_info "  Single step (SubmitCustomer) stuck test validates the feature."
echo ""

exit 0
