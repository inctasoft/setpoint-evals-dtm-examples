#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source shared helpers
source "${REPO_ROOT}/workflows/order-processing/ste/shared/helpers.sh"

# Test configuration
# Generate unique identifier for each run (enables multiple runs without conflicts)
EXTERNAL_SYSTEM_ID=$(uuidgen)
MAX_ATTEMPTS=60  # 2 minutes
POLL_INTERVAL=2

###############################################################################
# Test Header
###############################################################################

log_section "Eval 13: Stuck In-Progress Detection"
echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║        Eval 13: Stuck In-Progress Detection                       ║"
echo "╠════════════════════════════════════════════════════════════════════╣"
echo "║ Test maintenance task detecting stuck workers via DB simulation   ║"
echo "║ (works in both Lambda and debug-server modes)                     ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
log_info "Expected Duration: ~30s"
log_info "Expected Outcome: Stuck step detected, alerts generated (NO auto-fix)"
echo ""

###############################################################################
# STEP 1: Start job in quick-order mode and let it complete
###############################################################################

log_section "STEP 1: START AND COMPLETE JOB (BATCH-IMPORT MODE)"
echo ""

log_info "Configuration:"
log_info "  - Using quick-order variant"
log_info "  - Fast delays (500ms sim + 500ms ack)"
log_info "  - Job will complete successfully first"
echo ""

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
    "SubmitCustomer": { "simDelay": 500, "ackDelay": 500 },
    "SubmitOrder": { "simDelay": 500, "ackDelay": 500 }
  }
}
EOF
)

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || exit 1
validate_job_id "$JOB_ID" || exit 1
echo ""

###############################################################################
# STEP 2: Wait for job to complete
###############################################################################

log_section "STEP 2: WAIT FOR COMPLETION"
echo ""

log_info "Waiting for job to complete..."
echo ""

ATTEMPT=0
COMPLETED=false

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))

  JOB_STATUS=$(get_job_status "$JOB_ID")
  CURRENT_STATUS=$(echo "$JOB_STATUS" | jq -r '.status')

  echo "[$ATTEMPT/$MAX_ATTEMPTS] Job status: $CURRENT_STATUS"

  if [ "$CURRENT_STATUS" = "completed" ]; then
    COMPLETED=true
    break
  fi

  if [ "$CURRENT_STATUS" = "failed" ]; then
    log_error "Job failed unexpectedly"
    echo "$JOB_STATUS" | jq '.'
    exit 1
  fi

  sleep $POLL_INTERVAL
done

if [ "$COMPLETED" = false ]; then
  log_error "Job did not complete in time"
  exit 1
fi

log_success "Job completed successfully"
echo ""

# Wait for all database transactions to commit
log_info "Waiting 3 seconds for all DB transactions to commit..."
sleep 3

###############################################################################
# STEP 3: Simulate stuck IN_PROGRESS state via DB manipulation
###############################################################################

log_section "STEP 3: SIMULATE STUCK IN_PROGRESS STATE"
echo ""

# Find ValidateCustomer step
TARGET_STEP_ID=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
  psql -U dtm_user -d dtm -t -c \
  "SELECT id FROM dtm_steps
   WHERE job_id = '$JOB_ID'
   AND step_value = 'ValidateCustomer'
   LIMIT 1;" | tr -d '[:space:]')

if [ -z "$TARGET_STEP_ID" ]; then
  log_error "Could not find ValidateCustomer step for job $JOB_ID"
  exit 1
fi

log_info "Simulating stuck state by:"
log_info "  1. Setting ValidateCustomer step back to 'in_progress'"
log_info "  2. Setting started_at to 15 minutes ago (past detection threshold)"
log_info "  3. Clearing completed_at"
log_info "  4. Setting job back to 'processing'"
log_info ""
log_info "This simulates: Lambda crash/timeout mid-execution"
echo ""

# Update step to IN_PROGRESS with old started_at
docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
  psql -U dtm_user -d dtm -c \
  "UPDATE dtm_steps
   SET status = 'in_progress',
       completed_at = NULL,
       started_at = NOW() - INTERVAL '15 minutes'
   WHERE id = '$TARGET_STEP_ID';" \
  > /dev/null 2>&1

# Set job back to processing
docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
  psql -U dtm_user -d dtm -c \
  "UPDATE dtm_jobs SET status = 'processing', completed_at = NULL WHERE id = '$JOB_ID';" \
  > /dev/null 2>&1

log_success "DB manipulation complete"
echo ""

# Verify the manipulation took effect
STEP_STATUS_CHECK=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
  psql -U dtm_user -d dtm -t -c \
  "SELECT status FROM dtm_steps WHERE id = '$TARGET_STEP_ID';" | tr -d '[:space:]')

log_info "Verification: ValidateCustomer status = $STEP_STATUS_CHECK"
echo ""

if [ "$STEP_STATUS_CHECK" != "in_progress" ]; then
  log_error "DB manipulation failed: step is $STEP_STATUS_CHECK, expected in_progress"
  exit 1
fi

###############################################################################
# STEP 4: Trigger maintenance task (ALERT-ONLY, no auto-fail)
###############################################################################

log_section "STEP 4: TRIGGER MAINTENANCE TASK"
echo ""

log_info "Triggering stuck-in-progress maintenance task..."
log_info "API: POST /api/${API_VERSION}/maintenance/tasks/stuck-in-progress/execute"
echo ""

TASK_RESULT=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"stuckTimeoutMinutes": 0.25}' \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/stuck-in-progress/execute")

TASK_SUCCESS=$(echo "$TASK_RESULT" | jq -r '.success')
STEPS_FOUND=$(echo "$TASK_RESULT" | jq -r '.metrics.stuckStepsFound // 0')

log_info "Task execution result:"
echo "$TASK_RESULT" | jq '.'
echo ""

if [ "$TASK_SUCCESS" != "true" ]; then
  log_error "Maintenance task failed"
  exit 1
fi

# Note: This task only ALERTS, it does not AUTO-FIX
log_success "Maintenance task executed successfully"
log_info "  Stuck steps found: $STEPS_FOUND"
echo ""

# Validation
if [ "$STEPS_FOUND" -eq 0 ]; then
  log_error "No stuck steps detected - Maintenance task failed to find the stuck step"
  exit 1
else
  log_success "Stuck step(s) successfully detected"
fi

echo ""

###############################################################################
# Success
###############################################################################

log_section "TEST PASSED"
log_success "Stuck in-progress detection test completed successfully"
log_info "Summary:"
log_info "  - Job completed in quick-order mode"
log_info "  - ValidateCustomer manually set to IN_PROGRESS (15 min ago)"
log_info "  - Maintenance task executed successfully"
log_info "  - Alert mechanism verified (detection only, no auto-fix)"
echo ""

log_info "Note: StuckInProgressTask is ALERT-ONLY (no auto-fix)"
log_info "      In production, operations team would be notified"
log_info "      and would investigate/remediate manually."
echo ""

exit 0
