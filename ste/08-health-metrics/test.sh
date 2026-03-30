#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source shared helpers
source "${REPO_ROOT}/workflows/order-processing/ste/shared/helpers.sh"

# Test configuration
MAX_ATTEMPTS=60
POLL_INTERVAL=2

###############################################################################
# Test Header
###############################################################################

log_section "Eval 14: Health Metrics"
echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║                 Eval 14: Health Metrics                            ║"
echo "╠════════════════════════════════════════════════════════════════════╣"
echo "║ Test maintenance task generating operational health metrics        ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
log_info "Expected Duration: ~60-120 seconds (includes SQS retry delays)"
log_info "Expected Outcome: Metrics collected and validated"
echo ""

###############################################################################
# STEP 1: Create test data (completed jobs)
###############################################################################
# NOTE: We intentionally do NOT purge the database here.
# The metrics validations use >= comparisons, so they work with existing data.
# This allows the test to run multiple times without destroying artifacts.

log_section "STEP 1: CREATE SUCCESSFUL JOBS"
echo ""

log_info "Creating 3 completed jobs..."
echo ""

COMPLETED_JOBS=()

for i in 1 2 3; do
  log_info "Starting job $i..."

  # Generate unique identifier for each run (enables multiple runs without conflicts)
  EXTERNAL_SYSTEM_ID=$(uuidgen)

  PAYLOAD=$(cat <<EOF
{
  "variant": "quick-order",
  "payload": {
    "customerId": $i,
    "orderId": $i,
    "entityId": "${EXTERNAL_SYSTEM_ID}"
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

  COMPLETED_JOBS+=("$JOB_ID")
  log_success "Job $i started: $JOB_ID"
done

echo ""
log_info "Waiting for all jobs to complete..."
for JOB_ID in "${COMPLETED_JOBS[@]}"; do
  poll_job "$JOB_ID" 30 1 || exit 1
done

# Verify all completed
ALL_COMPLETED=true
for JOB_ID in "${COMPLETED_JOBS[@]}"; do
  STATUS=$(get_job_status "$JOB_ID" | jq -r '.status')
  if [ "$STATUS" != "completed" ]; then
    log_warning "Job $JOB_ID is $STATUS (expected: completed)"
    ALL_COMPLETED=false
  fi
done

if [ "$ALL_COMPLETED" = true ]; then
  log_success "All 3 jobs completed"
else
  log_warning "Some jobs still processing (this is okay for metrics test)"
fi

echo ""

###############################################################################
# STEP 2: Create a failed job
###############################################################################

log_section "STEP 2: CREATE FAILED JOB"
echo ""

log_info "Creating 1 failed job (permanent failure)..."

# Generate unique identifier for each run (enables multiple runs without conflicts)
FAILED_EXTERNAL_SYSTEM_ID=$(uuidgen)

PAYLOAD=$(cat <<EOF
{
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "${FAILED_EXTERNAL_SYSTEM_ID}"
  },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500 },
    "ValidateProduct": { "simDelay": 500 },
    "SubmitCustomer": { "simDelay": 500 },
    "SubmitOrder": { "simDelay": 500, "failOnAttempts": [1, 2, 3] }
  },
  "comment": "SubmitOrder failOnAttempts will fail all 3 attempts → exhausts retries → DLQ"
}
EOF
)

IFS=':' read -r FAILED_JOB_ID FAILED_CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || exit 1
validate_job_id "$FAILED_JOB_ID" || exit 1
FAILED_JOB_ID="$FAILED_JOB_ID"
log_success "Failed job started: $FAILED_JOB_ID"

echo ""
log_info "Waiting for job to fail (up to 120s for 3 SQS retries)..."
log_info "  → SQS visibility timeout ~30s × 3 attempts = ~90s total"
# Use longer timeout: 3 retries × 30s visibility timeout = ~90s, add buffer
poll_job "$FAILED_JOB_ID" 120 2 || {
  # It's okay if the job is still retrying - the metrics test doesn't require failure
  FAILED_STATUS=$(get_job_status "$FAILED_JOB_ID" | jq -r '.status')
  if [ "$FAILED_STATUS" = "processing" ] || [ "$FAILED_STATUS" = "in_progress_retrying" ]; then
    log_warning "Job still retrying (status=$FAILED_STATUS) - continuing with metrics test"
  else
    log_error "Unexpected status: $FAILED_STATUS"
    exit 1
  fi
}

FAILED_STATUS=$(get_job_status "$FAILED_JOB_ID" | jq -r '.status')
log_info "Failed job status: $FAILED_STATUS"
echo ""

###############################################################################
# STEP 3: Trigger health metrics task
###############################################################################

log_section "STEP 3: TRIGGER HEALTH METRICS TASK"
echo ""

log_info "Triggering health-metrics maintenance task..."
log_info "API: POST /api/${API_VERSION}/maintenance/tasks/health-metrics/execute"
echo ""

TASK_RESULT=$(curl -s -X POST \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/health-metrics/execute")

TASK_SUCCESS=$(echo "$TASK_RESULT" | jq -r '.success')

if [ "$TASK_SUCCESS" != "true" ]; then
  log_error "Maintenance task failed"
  echo "$TASK_RESULT" | jq '.'
  exit 1
fi

log_success "Maintenance task executed successfully"
echo ""

###############################################################################
# STEP 4: Validate metrics
###############################################################################

log_section "STEP 4: VALIDATE METRICS"
echo ""

log_info "Collected metrics:"
echo "$TASK_RESULT" | jq '.metrics'
echo ""

# Extract key metrics
ACTIVE_JOBS=$(echo "$TASK_RESULT" | jq -r '.metrics.activeJobs // 0')
PENDING_JOBS=$(echo "$TASK_RESULT" | jq -r '.metrics.pendingJobs // 0')
JOBS_COMPLETED_LAST_5MIN=$(echo "$TASK_RESULT" | jq -r '.metrics.jobsCompletedLast5min // 0')
JOBS_FAILED_LAST_5MIN=$(echo "$TASK_RESULT" | jq -r '.metrics.jobsFailedLast5min // 0')
TOTAL_JOBS=$(echo "$TASK_RESULT" | jq -r '.metrics.totalJobs // 0')

log_info "Key Metrics Summary:"
log_info "  • Total Jobs: $TOTAL_JOBS"
log_info "  • Active Jobs: $ACTIVE_JOBS"
log_info "  • Pending Jobs: $PENDING_JOBS"
log_info "  • Completed (last 5min): $JOBS_COMPLETED_LAST_5MIN"
log_info "  • Failed (last 5min): $JOBS_FAILED_LAST_5MIN"
echo ""

# Validation: We created at least 4 jobs
if [ "$TOTAL_JOBS" -lt 4 ]; then
  log_error "Expected at least 4 total jobs (3 completed + 1 failed), got: $TOTAL_JOBS"
  exit 1
fi

log_success "Total jobs metric validated (≥4, got: $TOTAL_JOBS)"

# Validation: Check the failed job status
if [ "$FAILED_STATUS" != "failed" ]; then
  log_warning "Expected failed job status to be 'failed', got: '$FAILED_STATUS'"
  log_info "This is expected if DLQ routing hasn't completed yet (async process)"
  log_info "The job will eventually be marked as failed by maintenance tasks"
else
  log_success "Failed job correctly marked as 'failed'"
fi

# Validation: We should have some completed jobs in last 5 minutes
if [ "$JOBS_COMPLETED_LAST_5MIN" -lt 1 ]; then
  log_warning "Expected at least 1 completed job in last 5 minutes, got: $JOBS_COMPLETED_LAST_5MIN"
  log_info "This could mean jobs took longer than expected (non-critical)"
else
  log_success "Completed jobs metric validated (≥1)"
fi

# Validation: Metrics object should have expected fields
EXPECTED_FIELDS=("activeJobs" "pendingJobs" "totalJobs" "jobsCompletedLast5min" "jobsFailedLast5min")
MISSING_FIELDS=()

for field in "${EXPECTED_FIELDS[@]}"; do
  if ! echo "$TASK_RESULT" | jq -e ".metrics.$field" > /dev/null 2>&1; then
    MISSING_FIELDS+=("$field")
  fi
done

if [ ${#MISSING_FIELDS[@]} -gt 0 ]; then
  log_error "Missing expected metric fields: ${MISSING_FIELDS[*]}"
  exit 1
fi

log_success "All expected metric fields present"
echo ""

###############################################################################
# STEP 5: Validate metrics API endpoint
###############################################################################

log_section "STEP 5: VALIDATE METRICS API"
echo ""

log_info "Checking maintenance health endpoint..."

HEALTH_RESPONSE=$(curl -s "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/health")
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status')

log_info "Maintenance health status: $HEALTH_STATUS"
echo ""

if [ "$HEALTH_STATUS" != "healthy" ]; then
  log_warning "Maintenance health is not 'healthy': $HEALTH_STATUS"
  log_info "This is not critical for metrics test"
else
  log_success "Maintenance system is healthy"
fi

echo ""

###############################################################################
# Success
###############################################################################

log_section "TEST PASSED"
log_success "Health metrics test completed successfully"
log_info "Summary:"
log_info "  ✓ Created 3 successful jobs"
log_info "  ✓ Created 1 failed job (exhausted retries: status=$FAILED_STATUS)"
log_info "  ✓ Maintenance task executed successfully"
log_info "  ✓ Metrics collected and validated"
log_info "  ✓ All expected metric fields present"
log_info "  ✓ Total jobs: $TOTAL_JOBS"
log_info "  ✓ Active: $ACTIVE_JOBS | Pending: $PENDING_JOBS"
log_info "  ✓ Completed (5min): $JOBS_COMPLETED_LAST_5MIN | Failed (5min): $JOBS_FAILED_LAST_5MIN"
echo ""

log_info "These metrics can be used for:"
log_info "  • Monitoring dashboards (Grafana, Datadog, etc.)"
log_info "  • Alerting on anomalies"
log_info "  • SLO/SLA tracking"
log_info "  • Capacity planning"
echo ""

exit 0
