#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 02: Environment Not Found
# ═══════════════════════════════════════════════════════════════════════════
# Tests error handling when initiating a job for a non-existent environment.
#
# Expected behavior:
#   1. PlanEnvironment step fails (environment not in source DB)
#   2. Environment is a CRITICAL entity (criticality: "required")
#   3. Outcome rule "critical-entity-failed" fires
#   4. Job reaches FAILED status
#   5. Downstream steps (ApplyEnvironment, PlanNetwork, etc.) do NOT execute
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 02: Environment Not Found"
EVAL_PURPOSE="Test failure handling when critical entity (environment) does not exist"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: ENV-NONEXISTENT (does NOT exist in source DB)"
log_info "Variant: default"
log_info "Expected Outcome: Job FAILS (critical entity failed)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with Non-Existent Environment
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (NON-EXISTENT ENVIRONMENT)"

PAYLOAD='{
  "variant": "default",
  "payload": {
    "environmentId": "ENV-NONEXISTENT",
    "entityId": "ENV-NONEXISTENT"
  },
  "testOptions": {
    "PlanEnvironment":    { "simDelay": 300, "maxRetries": 0 },
    "ApplyEnvironment":   { "simDelay": 300, "ackDelay": 1000 },
    "PlanNetwork":        { "simDelay": 300 },
    "ApplyNetwork":       { "simDelay": 300, "ackDelay": 1000 }
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

# Test 2: PlanEnvironment should be FAILED
if verify_step_status "$JOB_ID" "PlanEnvironment" "FAILED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: ApplyEnvironment should NOT be COMPLETED (dependency failed)
FINAL_STATUS_JSON=$(get_job_status "$JOB_ID")
TE_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "ApplyEnvironment")

if [[ "${TE_STATUS,,}" != "completed" ]]; then
  log_success "ApplyEnvironment correctly NOT completed (status: ${TE_STATUS})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "ApplyEnvironment should NOT be completed when PlanEnvironment fails"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: PlanNetwork should NOT be COMPLETED (depends on ApplyEnvironment)
EN_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "PlanNetwork")

if [[ "${EN_STATUS,,}" != "completed" ]]; then
  log_success "PlanNetwork correctly NOT completed (status: ${EN_STATUS})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "PlanNetwork should NOT be completed when PlanEnvironment fails"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
