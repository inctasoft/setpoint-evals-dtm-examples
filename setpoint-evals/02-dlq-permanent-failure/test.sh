#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# Eval 03: DLQ Permanent Failure
# ═══════════════════════════════════════════════════════════════════════════
# Tests SQS Dead Letter Queue routing when a Lambda worker exhausts all retry
# attempts. The Lambda returns batchItemFailures to SQS, which manages retries
# via visibility timeout. After maxReceiveCount is exceeded, SQS routes the
# message to the DLQ.
#
# ARCHITECTURE:
#   1. Lambda fails → sends callback to orchestrator (for tracking)
#   2. Lambda returns batchItemFailures to SQS
#   3. SQS waits visibility timeout (~30s)
#   4. SQS re-delivers message (ReceiveCount++)
#   5. Repeat until maxReceiveCount (3)
#   6. SQS routes message to DLQ
#   7. Orchestrator marks step as FAILED
#
# NOTE: Orchestrator does NOT re-delegate. SQS handles all retry logic.
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${REPO_ROOT}/workflows/order-processing/setpoint-evals/shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Parse Command Line Arguments
# ═══════════════════════════════════════════════════════════════════════════

TIMEOUT_ADDITION=0

for arg in "$@"; do
  case $arg in
    --add-timeout=*)
      TIMEOUT_ADDITION="${arg#*=}"
      log_info "Adding ${TIMEOUT_ADDITION}s to polling timeout"
      ;;
    --help)
      echo "Usage: $0 [--add-timeout=SECONDS]"
      echo ""
      echo "Options:"
      echo "  --add-timeout=N    Add N seconds to the polling timeout (default: 0)"
      echo "                     Useful for testing DLQ routing delays"
      echo ""
      exit 0
      ;;
  esac
done

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="Eval 03: DLQ Permanent Failure"
EVAL_PURPOSE="Test Dead Letter Queue routing for permanent failures"
EXPECTED_DURATION="~120 seconds (SQS visibility timeouts)"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Expected Duration: ${EXPECTED_DURATION}"
log_info "Expected Outcome: Job FAILS (SubmitOrder → DLQ)"
echo ""

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║ 📋 Architecture: SQS-Managed Retries                                 ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║ 1. Lambda fails → returns batchItemFailures to SQS                  ║${NC}"
echo -e "${BLUE}║ 2. Lambda sends 'failed' callback to orchestrator (for tracking)   ║${NC}"
echo -e "${BLUE}║ 3. SQS waits visibility timeout (~30s)                              ║${NC}"
echo -e "${BLUE}║ 4. SQS re-delivers message (ReceiveCount++)                         ║${NC}"
echo -e "${BLUE}║ 5. After maxReceiveCount (3), SQS routes message to DLQ             ║${NC}"
echo -e "${BLUE}║                                                                      ║${NC}"
echo -e "${BLUE}║ ⚠️  Orchestrator does NOT re-delegate. SQS handles all retries.     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB"

# Generate unique identifier for each run (enables multiple runs without conflicts)
EXTERNAL_SYSTEM_ID=$(uuidgen)

PAYLOAD='{
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "'"${EXTERNAL_SYSTEM_ID}"'"
  },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500, "failOnAttempts": [1, 2] },
    "ValidateProduct": { "simDelay": 500, "failOnAttempts": [1] },
    "SubmitCustomer": { "simDelay": 500, "ackDelay": 100, "failOnAttempts": [1, 2] },
    "SubmitOrder": { "simDelay": 500, "ackDelay": 100, "failOnAttempts": [1, 2, 3, 4, 5, 6, 7] }
  }
}'

# Capture both IDs
IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || exit 1
validate_job_id "$JOB_ID" || exit 1

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Display Expected Timeline
# ═══════════════════════════════════════════════════════════════════════════

log_section "EXPECTED TIMELINE"

echo -e "  ${YELLOW}SQS manages retries via visibility timeout (~30s each)${NC}"
echo ""
echo -e "  ${CYAN}t=0-30s${NC}    All steps attempt 1 (some fail, some succeed)"
echo -e "  ${CYAN}t=30-60s${NC}   SQS re-delivers failed messages (attempt 2)"
echo -e "  ${CYAN}t=60-90s${NC}   SQS re-delivers failed messages (attempt 3)"
echo -e "  ${CYAN}t=90-120s${NC}  SubmitOrder → ${RED}DLQ (maxReceiveCount exceeded)${NC}"
echo ""
echo -e "  ${RED}Final: Job FAILED, SubmitOrder message in DLQ${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 3: Monitor Progress
# ═══════════════════════════════════════════════════════════════════════════

log_section "MONITORING PROGRESS"

echo -e "${BLUE}💡 TIP: Open additional terminals to monitor:${NC}"
echo -e "   ${CYAN}./scripts/local-env.sh monitor sqs${NC}  ${BLUE}(watch DLQ count!)${NC}"
echo -e "   ${CYAN}./scripts/local-env.sh logs submit-order-worker${NC}"
echo ""

# Custom polling function for DLQ test
poll_for_failure_and_dlq() {
  local job_id="$1"
  local max_polls="${2:-100}"
  local interval="${3:-3}"

  log_step "Monitoring job progress..."
  echo ""

  local poll_count=0
  local job_failed=false

  while [ $poll_count -lt $max_polls ]; do
    sleep "$interval"
    poll_count=$((poll_count + 1))

    # Get status
    local status_response
    status_response=$(get_job_status "$job_id")

    local job_status
    job_status=$(extract_job_status "$status_response")

    # Extract step statuses
    local ec_status=$(extract_step_status "$status_response" "ValidateCustomer" 2>/dev/null || echo "pending")
    local ep_status=$(extract_step_status "$status_response" "ValidateProduct" 2>/dev/null || echo "pending")
    local tc_status=$(extract_step_status "$status_response" "SubmitCustomer" 2>/dev/null || echo "pending")
    local to_status=$(extract_step_status "$status_response" "SubmitOrder" 2>/dev/null || echo "pending")

    # Color-code TO status
    local to_color="${CYAN}"
    if [[ "${to_status,,}" == *"retry"* ]] || [[ "${to_status,,}" == *"progress"* ]]; then
      to_color="${YELLOW}"
    elif [[ "${to_status,,}" == "failed" ]]; then
      to_color="${RED}"
    elif [[ "${to_status,,}" == "completed" ]]; then
      to_color="${GREEN}"
    fi

    echo -e "[${poll_count}/${max_polls}] Job: ${CYAN}${job_status}${NC} | VC=${ec_status} VP=${ep_status} SC=${tc_status} SO=${to_color}${to_status}${NC}"

    # Check if job has failed
    if [[ "${job_status,,}" == "failed" ]]; then
      if [ "$job_failed" = false ]; then
        echo ""
        log_success "Job reached FAILED status!"
        log_info "SubmitOrder exhausted all retry attempts"
        job_failed=true
      fi
      return 0
    fi

    # Unexpected: Job completed successfully
    if [[ "${job_status,,}" == "completed" ]]; then
      echo ""
      log_error "Job COMPLETED unexpectedly (should have failed)"
      return 1
    fi
  done

  echo ""
  log_warning "Polling timed out after ${max_polls} attempts"
  return 1
}

# Allow extra time for SQS visibility timeouts (30s × 3 = 90s minimum)
BASE_MAX_POLLS=100
ADJUSTED_MAX_POLLS=$((BASE_MAX_POLLS + (TIMEOUT_ADDITION / 3)))

if [ "$TIMEOUT_ADDITION" -gt 0 ]; then
  log_info "Adjusted polling: ${ADJUSTED_MAX_POLLS} polls (added ${TIMEOUT_ADDITION}s)"
fi

poll_for_failure_and_dlq "$JOB_ID" "$ADJUSTED_MAX_POLLS" 3

# ═══════════════════════════════════════════════════════════════════════════
# Step 4: Display Results
# ═══════════════════════════════════════════════════════════════════════════

display_results "$JOB_ID"

# ═══════════════════════════════════════════════════════════════════════════
# Step 5: Verification
# ═══════════════════════════════════════════════════════════════════════════

log_section "VERIFICATION"

PASS_COUNT=0
FAIL_COUNT=0

STATUS_RESPONSE=$(get_job_status "$JOB_ID")
JOB_STATUS=$(extract_job_status "$STATUS_RESPONSE")

# Test 1: Job should be FAILED
log_step "Test 1: Verify job status is FAILED..."
if [[ "${JOB_STATUS,,}" == "failed" ]]; then
  log_success "Test 1: Job status is FAILED ✅"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Test 1 FAILED: Job status is '${JOB_STATUS}' (expected: FAILED)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 2: ValidateCustomer should be COMPLETED
log_step "Test 2: Verify ValidateCustomer is COMPLETED..."
if verify_step_status "$JOB_ID" "ValidateCustomer" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: SubmitCustomer should be COMPLETED
log_step "Test 3: Verify SubmitCustomer is COMPLETED..."
if verify_step_status "$JOB_ID" "SubmitCustomer" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 5: SubmitOrder should be FAILED
log_step "Test 5: Verify SubmitOrder is FAILED..."
TO_STATUS=$(extract_step_status "$STATUS_RESPONSE" "SubmitOrder")
if [[ "${TO_STATUS,,}" == "failed" ]]; then
  log_success "Test 5: SubmitOrder is FAILED ✅"
  log_info "   SQS exhausted maxReceiveCount (3 attempts)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Test 5 FAILED: SubmitOrder is '${TO_STATUS}' (expected: FAILED)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 6: DiscoverLineItems should be SKIPPED (cascade effect)
log_step "Test 6: Verify DiscoverLineItems is SKIPPED (cascade failure)..."
DOI_STATUS=$(extract_step_status "$STATUS_RESPONSE" "DiscoverLineItems" 2>/dev/null || echo "not_found")
if [[ "${DOI_STATUS,,}" == "skipped" ]]; then
  log_success "Test 6: DiscoverLineItems is SKIPPED ✅"
  log_info "   Correctly skipped due to SubmitOrder failure"
  PASS_COUNT=$((PASS_COUNT + 1))
elif [[ "${DOI_STATUS,,}" == "not_found" ]] || [[ "${DOI_STATUS,,}" == "pending" ]] || [[ "${DOI_STATUS,,}" == "null" ]]; then
  log_warning "Test 6: DiscoverLineItems status is '${DOI_STATUS}' (acceptable)"
  log_info "   Step does not exist in quick-order variant"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Test 6 FAILED: DiscoverLineItems is '${DOI_STATUS}' (expected: SKIPPED or PENDING)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 7: Job-Level Statistics
log_step "Test 7: Verify Job-Level Statistics..."
FINAL_STATUS_JSON=$(get_job_status "$JOB_ID")
STEPS_COMPLETED=$(echo "$FINAL_STATUS_JSON" | jq -r '.result.stepsCompleted // 0')

# Expected: 3 steps complete (VC, SC, VO complete; SO fails in quick-order)
if [ "$STEPS_COMPLETED" -ge 3 ] && [ "$STEPS_COMPLETED" -le 4 ]; then
  log_success "Test 7: Steps completed: $STEPS_COMPLETED (expected: 3-4) ✅"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Test 7 FAILED: Steps completed: $STEPS_COMPLETED (expected: 3-4)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 6: Architecture Explanation
# ═══════════════════════════════════════════════════════════════════════════

log_section "ARCHITECTURE NOTES"

echo -e "${BLUE}How SQS-Managed Retries Work:${NC}"
echo ""
echo -e "  1. ${GREEN}Lambda processes message${NC}, detects simulated failure"
echo -e "  2. ${GREEN}Lambda sends 'failed' callback to orchestrator${NC} (for tracking)"
echo -e "  3. ${GREEN}Lambda returns batchItemFailures${NC} to SQS"
echo -e "  4. ${GREEN}SQS keeps the message${NC} (does NOT delete)"
echo -e "  5. ${GREEN}SQS waits visibility timeout${NC} (~30s)"
echo -e "  6. ${GREEN}SQS re-delivers${NC} (ReceiveCount++)"
echo -e "  7. ${GREEN}After maxReceiveCount${NC}, SQS routes to DLQ"
echo ""
echo -e "${YELLOW}⚠️  Key Point: Orchestrator does NOT re-delegate!${NC}"
echo -e "    SQS handles all retry logic automatically via:"
echo -e "    - Visibility timeout (delay between retries)"
echo -e "    - maxReceiveCount (max retry attempts)"
echo -e "    - RedrivePolicy (DLQ routing)"
echo ""
echo -e "${BLUE}Why This Matters:${NC}"
echo -e "  • ${CYAN}Retry delays are SQS visibility timeout (~30s)${NC}"
echo -e "  • ${CYAN}Total time to DLQ: ~90-120s (3 × 30s + processing)${NC}"
echo -e "  • ${CYAN}Orchestrator passively tracks failure callbacks${NC}"
echo ""

log_section "ADDITIONAL VERIFICATION"

echo -e "${BLUE}Check Lambda logs (should show 3 failure attempts):${NC}"
echo -e "  ${CYAN}./scripts/local-env.sh logs submit-order-worker | grep -i 'attempt\\|failed'${NC}"
echo ""

echo -e "${BLUE}Check SQS DLQ (message should be there after ~120s):${NC}"
echo -e "  ${CYAN}./scripts/local-env.sh monitor sqs${NC}"
echo ""

echo -e "${BLUE}Check job details:${NC}"
echo -e "  ${CYAN}curl ${ORCHESTRATOR_HOST}/api/${API_VERSION}/jobs/${JOB_ID} | jq${NC}"
echo ""

echo -e "${BLUE}Query step retry counts:${NC}"
echo -e "  ${CYAN}docker exec dtm-db psql -U dtm_user -d dtm -c \"SELECT step_value, status, retry_count FROM dtm_steps WHERE job_id='${JOB_ID}'\"${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
