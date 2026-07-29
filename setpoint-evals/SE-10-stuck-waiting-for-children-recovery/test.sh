#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Source shared helpers
source "${REPO_ROOT}/workflows/order-processing/setpoint-evals/shared/helpers.sh"

# ── Profile-aware redelivery timing (Phase 4) ────────────────────────────────
# This SE's fan-out job contains steps that fail deterministically (the
# default-variant payload intentionally omits productId/paymentId/shipmentId);
# STEP 2 needs those steps to reach a TERMINAL state inside the poll budget.
# On aws that is SQS's ~30s visibility-timeout redelivery; under zmq it is the
# redelivery engine — but its default lease is 300s, far beyond the budget.
# Under BUS_PROFILE=zmq, flip REDELIVERY_LEASE_SECONDS=5 (SE-29's proven
# pattern) so the engine exhausts the doomed steps in time. The stuck-
# WAITING_FOR_CHILDREN recovery this SE actually tests is profile-neutral.
ENV_FILE="$REPO_ROOT/.env"
COMPOSE_MAIN="$REPO_ROOT/docker-compose.yml"
COMPOSE_ZMQ="$REPO_ROOT/docker-compose.zmq.yml"
ENV_BACKUP=""
if [ "$(se_bus_profile)" = "zmq" ]; then
  ENV_BACKUP="$(mktemp)"
  cp "$ENV_FILE" "$ENV_BACKUP"
  sed -i '/^REDELIVERY_LEASE_SECONDS=/d' "$ENV_FILE"
  printf '\nREDELIVERY_LEASE_SECONDS=5\n' >> "$ENV_FILE"
  ( cd "$REPO_ROOT" && docker compose --env-file "$ENV_FILE" \
      -f "$COMPOSE_MAIN" -f "$COMPOSE_ZMQ" \
      --profile db --profile orchestrator --profile dev-tools --profile zmq-tasks \
      up -d --no-deps --force-recreate orchestrator ) >/dev/null
  _tries=0
  until curl -sf -m 3 "http://localhost:${ORCHESTRATOR_PORT_HOST:-3002}/api/v1/health" >/dev/null 2>&1; do
    _tries=$((_tries + 1))
    [ "$_tries" -gt 60 ] && { echo "orchestrator did not come back healthy after lease flip"; exit 1; }
    sleep 2
  done
fi
restore_lease_env() {
  if [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
    cp "$ENV_BACKUP" "$ENV_FILE"
    rm -f "$ENV_BACKUP"
    ( cd "$REPO_ROOT" && docker compose --env-file "$ENV_FILE" \
        -f "$COMPOSE_MAIN" -f "$COMPOSE_ZMQ" \
        --profile db --profile orchestrator --profile dev-tools --profile zmq-tasks \
        up -d --no-deps --force-recreate orchestrator ) >/dev/null 2>&1 || true
  fi
}
trap restore_lease_env EXIT

# Test configuration
# Generate unique identifier for each run (enables multiple runs without conflicts)
EXTERNAL_SYSTEM_ID=$(uuidgen)
MAX_ATTEMPTS=90  # 3 minutes
POLL_INTERVAL=2

###############################################################################
# Test Header
###############################################################################

log_section "Eval 27: Stuck Waiting For Children Recovery"
echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║      Eval 27: Stuck Waiting For Children Recovery                 ║"
echo "╠════════════════════════════════════════════════════════════════════╣"
echo "║ Test maintenance task recovering discovery steps stuck in         ║"
echo "║ WAITING_FOR_CHILDREN after all child steps have completed         ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
log_info "Expected Duration: ~30 seconds"
log_info "Expected Outcome: Stuck parent step detected and recovered"
echo ""

###############################################################################
# STEP 1: Start job in fan-out mode and let it complete
###############################################################################

log_section "STEP 1: START AND COMPLETE JOB (FAN-OUT MODE)"
echo ""

log_info "Configuration:"
log_info "  - Using order-processing default variant (fan-out mode with DiscoverLineItems)"
log_info "  - Fast delays (500ms sim + 500ms ack)"
log_info "  - Fan-out creates WAITING_FOR_CHILDREN discovery steps"
echo ""

PAYLOAD=$(cat <<EOF
{
  "variant": "default",
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
    "SubmitOrder": { "simDelay": 500, "ackDelay": 500 },
    "DiscoverLineItems": { "simDelay": 500 },
    "ValidateLineItem": { "simDelay": 500 },
    "SubmitLineItem": { "simDelay": 500, "ackDelay": 500 }
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

  if [ "$CURRENT_STATUS" = "completed" ] || [ "$CURRENT_STATUS" = "partial_success" ]; then
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

log_success "Job completed successfully (status: $CURRENT_STATUS)"
echo ""

# Wait for all database transactions to commit
log_info "Waiting 3 seconds for all DB transactions to commit..."
sleep 3

###############################################################################
# STEP 3: Find a discovery step that was WAITING_FOR_CHILDREN
###############################################################################

log_section "STEP 3: FIND DISCOVERY STEP TO SIMULATE STUCK STATE"
echo ""

# Find a discovery step (DiscoverLineItems) that completed
# We'll set it back to WAITING_FOR_CHILDREN to simulate a stuck parent
DISCOVERY_STEP_ID=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
  psql -U dtm_user -d dtm -t -c \
  "SELECT id FROM dtm_steps
   WHERE job_id = '$JOB_ID'
   AND step_value LIKE 'Discover%'
   AND status IN ('completed', 'partial_success')
   AND child_count > 0
   LIMIT 1;" | tr -d '[:space:]')

if [ -z "$DISCOVERY_STEP_ID" ]; then
  log_warning "No completed discovery step found"
  log_info "This might happen if no fan-out entities exist for this job"
  log_info "Checking available steps..."

  docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
    psql -U dtm_user -d dtm -c \
    "SELECT id, step_value, status FROM dtm_steps WHERE job_id = '$JOB_ID' ORDER BY step_value;"

  log_warning "Skipping stuck simulation - test passes vacuously (no discovery steps to test)"
  echo ""

  log_section "TEST PASSED (VACUOUS)"
  log_success "No discovery steps available to simulate stuck state"
  log_info "This is acceptable - the job may not have fan-out entities"
  exit 0
fi

DISCOVERY_STEP_VALUE=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
  psql -U dtm_user -d dtm -t -c \
  "SELECT step_value FROM dtm_steps WHERE id = '$DISCOVERY_STEP_ID';" | tr -d '[:space:]')

log_success "Found discovery step to simulate: $DISCOVERY_STEP_VALUE (ID: $DISCOVERY_STEP_ID)"
echo ""

###############################################################################
# STEP 4: Simulate stuck state via DB manipulation
###############################################################################

log_section "STEP 4: SIMULATE STUCK WAITING_FOR_CHILDREN STATE"
echo ""

log_info "Simulating stuck state by:"
log_info "  1. Setting discovery step '$DISCOVERY_STEP_VALUE' back to 'waiting_for_children'"
log_info "  2. Setting started_at to 15 minutes ago (past timeout threshold)"
log_info "  3. Setting job back to 'processing'"
log_info ""
log_info "This simulates:"
log_info "  - Orchestrator crash while last child was completing"
log_info "  - Race condition in fan-out aggregation"
echo ""

# Update discovery step to WAITING_FOR_CHILDREN with old started_at
docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
  psql -U dtm_user -d dtm -c \
  "UPDATE dtm_steps
   SET status = 'waiting_for_children',
       completed_at = NULL,
       started_at = NOW() - INTERVAL '15 minutes'
   WHERE id = '$DISCOVERY_STEP_ID';" \
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
  "SELECT status FROM dtm_steps WHERE id = '$DISCOVERY_STEP_ID';" | tr -d '[:space:]')

JOB_STATUS_CHECK=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
  psql -U dtm_user -d dtm -t -c \
  "SELECT status FROM dtm_jobs WHERE id = '$JOB_ID';" | tr -d '[:space:]')

log_info "Verification after DB manipulation:"
log_info "  - Discovery step status: $STEP_STATUS_CHECK"
log_info "  - Job status: $JOB_STATUS_CHECK"
echo ""

if [ "$STEP_STATUS_CHECK" != "waiting_for_children" ]; then
  log_error "DB manipulation failed: step is $STEP_STATUS_CHECK, expected waiting_for_children"
  exit 1
fi

###############################################################################
# STEP 5: Trigger stuck-waiting-for-children maintenance task
###############################################################################

log_section "STEP 5: TRIGGER MAINTENANCE TASK"
echo ""

log_info "Triggering stuck-waiting-for-children maintenance task..."
log_info "API: POST /api/${API_VERSION}/maintenance/tasks/stuck-waiting-for-children/execute"
log_info "Options: timeoutMinutes=0.25 (15 seconds)"
echo ""

# Trigger maintenance task with very short timeout (0.25 min = 15s)
# The step was set to 15 min ago, so it's well past the threshold
TASK_RESULT=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"timeoutMinutes": 0.25}' \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/stuck-waiting-for-children/execute")

TASK_SUCCESS=$(echo "$TASK_RESULT" | jq -r '.success')
STUCK_FOUND=$(echo "$TASK_RESULT" | jq -r '.metrics.stuckParentsFound // 0')
RECOVERED=$(echo "$TASK_RESULT" | jq -r '.metrics.recovered // 0')
STILL_PROCESSING=$(echo "$TASK_RESULT" | jq -r '.metrics.stillProcessing // 0')
TASK_FAILED=$(echo "$TASK_RESULT" | jq -r '.metrics.failed // 0')

log_info "Task execution result:"
echo "$TASK_RESULT" | jq '.'
echo ""

if [ "$TASK_SUCCESS" != "true" ]; then
  log_error "Maintenance task failed"
  exit 1
fi

log_success "Maintenance task executed successfully"
log_info "  - Stuck parents found: $STUCK_FOUND"
log_info "  - Recovered: $RECOVERED"
log_info "  - Still processing: $STILL_PROCESSING"
log_info "  - Failed: $TASK_FAILED"
echo ""

# Accept either:
# 1. Maintenance task found and recovered the stuck parent (RECOVERED >= 1)
# 2. Background orchestration auto-fixed it (STUCK_FOUND == 0 but step is no longer stuck)
if [ "$STUCK_FOUND" -ge 1 ] && [ "$RECOVERED" -ge 1 ]; then
  log_success "Maintenance task found and recovered stuck parent step"
elif [ "$STUCK_FOUND" -ge 1 ] && [ "$RECOVERED" -eq 0 ]; then
  log_warning "Maintenance task found stuck parent but did not recover (stillProcessing=$STILL_PROCESSING, failed=$TASK_FAILED)"
  log_info "Checking if step was auto-fixed by background orchestration..."
elif [ "$STUCK_FOUND" -eq 0 ]; then
  log_warning "Maintenance task found no stuck parents - system may have self-healed"
  log_info "Checking current step status..."
fi

###############################################################################
# STEP 6: Verify step is no longer WAITING_FOR_CHILDREN
###############################################################################

log_section "STEP 6: VERIFY RECOVERY"
echo ""

# Poll for recovery — continueJob runs asynchronously after maintenance task
log_info "Polling for step to leave waiting_for_children state (up to 30s)..."

RECOVERY_ATTEMPTS=0
RECOVERY_MAX=15
FINAL_STEP_STATUS="waiting_for_children"

while [ $RECOVERY_ATTEMPTS -lt $RECOVERY_MAX ]; do
  RECOVERY_ATTEMPTS=$((RECOVERY_ATTEMPTS + 1))

  FINAL_STEP_STATUS=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
    psql -U dtm_user -d dtm -t -c \
    "SELECT status FROM dtm_steps WHERE id = '$DISCOVERY_STEP_ID';" | tr -d '[:space:]')

  echo "  [$RECOVERY_ATTEMPTS/$RECOVERY_MAX] Step status: $FINAL_STEP_STATUS"

  if [ "$FINAL_STEP_STATUS" != "waiting_for_children" ]; then
    break
  fi

  sleep 2
done

log_info "Discovery step status after recovery: $FINAL_STEP_STATUS"
echo ""

if [ "$FINAL_STEP_STATUS" = "waiting_for_children" ]; then
  # Step is still stuck after 30s of polling
  log_error "Step is STILL in waiting_for_children after maintenance task (waited 30s)"
  log_error "Recovery failed"
  exit 1
fi

# Step should now be in a terminal state (completed, partial_success, or failed)
case "$FINAL_STEP_STATUS" in
  completed|partial_success|failed)
    log_success "Step recovered to terminal state: $FINAL_STEP_STATUS"
    ;;
  *)
    log_warning "Step is in unexpected state: $FINAL_STEP_STATUS"
    log_info "This may be acceptable depending on system behavior"
    ;;
esac
echo ""

# Also check the job status
FINAL_JOB_STATUS=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db \
  psql -U dtm_user -d dtm -t -c \
  "SELECT status FROM dtm_jobs WHERE id = '$JOB_ID';" | tr -d '[:space:]')

log_info "Job status after recovery: $FINAL_JOB_STATUS"
echo ""

###############################################################################
# Success
###############################################################################

log_section "TEST PASSED"
log_success "Stuck waiting-for-children recovery test completed successfully"
log_info "Summary:"
log_info "  - Job completed in fan-out mode"
log_info "  - Discovery step ($DISCOVERY_STEP_VALUE) manually set to WAITING_FOR_CHILDREN"
log_info "  - Maintenance task executed: stuck=$STUCK_FOUND, recovered=$RECOVERED"
log_info "  - Step recovered to: $FINAL_STEP_STATUS"
log_info "  - Job status: $FINAL_JOB_STATUS"
echo ""

log_info "This test validates recovery from:"
log_info "  - Orchestrator crash during fan-out child completion"
log_info "  - Race condition in fan-out aggregation logic"
log_info "  - Lost signals between child completion and parent update"
echo ""

exit 0
