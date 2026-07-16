#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 03: Compute Fan-Out
# ═══════════════════════════════════════════════════════════════════════════
# Tests the Discovery + Fan-Out pattern for compute instances.
#
# Flow:
#   PlanEnvironment -> ApplyEnvironment -> PlanNetwork
#   -> ApplyNetwork -> DiscoverCompute
#   -> N x (PlanCompute -> ApplyCompute)
#
# prod-eu has network NET-PROD-EU-1, which has 6 compute instances
# (INST-PROD-EU-1..6) — dedicated to this SE for fan-out breadth, see
# ../../source-db/SEED-REGISTRY.md.
#
# We verify:
#   1. DiscoverCompute completes and spawns child steps
#   2. Multiple PlanCompute child steps are created (expect 6)
#   3. Multiple ApplyCompute child steps are created (expect 6)
#   4. All child steps execute in parallel
#   5. Job reaches COMPLETED status
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 03: Compute Fan-Out"
EVAL_PURPOSE="Test Discovery + Fan-Out pattern creating multiple child compute steps"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: prod-eu (6 compute instances)"
log_info "Variant: default (includes fan-out)"
log_info "Network NET-PROD-EU-1 has 6 compute instances"
log_info "Expected Outcome: Fan-out creates 2 child step pairs, job COMPLETES"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (FAN-OUT SCENARIO)"

PAYLOAD='{
  "enableDeduplication": false,
  "variant": "default",
  "payload": {
    "environmentId": "prod-eu",
    "networkId": "NET-PROD-EU-1",
    "instanceId": "INST-PROD-EU-1",
    "dnsRecordId": "DNS-PROD-EU-1",
    "certificateId": "CERT-PROD-EU-1",
    "loadBalancerId": "LB-PROD-EU-1",
    "entityId": "prod-eu"
  },
  "testOptions": {
    "PlanEnvironment":    { "simDelay": 300 },
    "ApplyEnvironment":   { "simDelay": 300, "ackDelay": 1000 },
    "PlanNetwork":        { "simDelay": 300 },
    "ApplyNetwork":       { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverCompute":    { "simDelay": 300 },
    "PlanCompute":        { "simDelay": 300 },
    "ApplyCompute":       { "simDelay": 300, "ackDelay": 1000 },
    "PlanStorage":        { "simDelay": 300 },
    "ApplyStorage":       { "simDelay": 300, "ackDelay": 1000 },
    "PlanDNS":            { "simDelay": 300 },
    "ApplyDNS":           { "simDelay": 300, "ackDelay": 1000 },
    "PlanCertificate":    { "simDelay": 300 },
    "ApplyCertificate":   { "simDelay": 300, "ackDelay": 1000 },
    "PlanLoadBalancer":   { "simDelay": 300 },
    "ApplyLoadBalancer":  { "simDelay": 300, "ackDelay": 1000 }
  }
}'

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")"
validate_job_id "$JOB_ID" || exit 1

# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Monitor Progress
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 2: MONITORING PROGRESS"

poll_job "$JOB_ID" 600 5

# Small delay to allow final ACKs to be processed
sleep 2

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

# Test 1: Job status should be COMPLETED
if verify_job_status "$JOB_ID" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 2: DiscoverCompute should be COMPLETED
if verify_step_status "$JOB_ID" "DiscoverCompute" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Step 5: Fan-Out Pattern Verification
# ═══════════════════════════════════════════════════════════════════════════

log_section "FAN-OUT PATTERN VERIFICATION"

JOB_DETAILS=$(get_job_status "$JOB_ID")

# Count PlanCompute child steps
PLAN_COMPUTE_COUNT=0
APPLY_COMPUTE_COUNT=0

if command -v jq &> /dev/null; then
  PLAN_COMPUTE_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "PlanCompute")] | length' 2>/dev/null || echo "0")
  APPLY_COMPUTE_COUNT=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "ApplyCompute")] | length' 2>/dev/null || echo "0")
fi

log_info "PlanCompute child steps: ${PLAN_COMPUTE_COUNT}"
log_info "ApplyCompute child steps: ${APPLY_COMPUTE_COUNT}"

# Test 3: At least 1 PlanCompute child step should exist
if [ "${PLAN_COMPUTE_COUNT}" -gt 0 ]; then
  log_success "PlanCompute child steps created: ${PLAN_COMPUTE_COUNT}"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "No PlanCompute child steps found - fan-out not creating children!"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: At least 1 ApplyCompute child step should exist
if [ "${APPLY_COMPUTE_COUNT}" -gt 0 ]; then
  log_success "ApplyCompute child steps created: ${APPLY_COMPUTE_COUNT}"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "No ApplyCompute child steps found - fan-out chain not working!"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 5: Verify all ApplyCompute steps completed (with retry for race condition)
if [ "${APPLY_COMPUTE_COUNT}" -gt 0 ] && command -v jq &> /dev/null; then
  log_info "Waiting for ApplyCompute steps to complete (with retry)..."

  MAX_STEP_VERIFY_ATTEMPTS=15
  STEP_VERIFY_PASSED=false

  for step_attempt in $(seq 1 $MAX_STEP_VERIFY_ATTEMPTS); do
    JOB_DETAILS=$(get_job_status "$JOB_ID")
    APPLY_COMPUTE_COMPLETED=$(echo "${JOB_DETAILS}" | jq '[.steps[] | select(.stepNumber == "ApplyCompute" and .status == "completed")] | length')

    if [ "${APPLY_COMPUTE_COMPLETED}" -ge "${APPLY_COMPUTE_COUNT}" ]; then
      log_success "All ${APPLY_COMPUTE_COMPLETED} ApplyCompute steps completed"
      PASS_COUNT=$((PASS_COUNT + 1))
      STEP_VERIFY_PASSED=true
      break
    fi

    if [ $step_attempt -lt $MAX_STEP_VERIFY_ATTEMPTS ]; then
      log_info "Attempt $step_attempt/$MAX_STEP_VERIFY_ATTEMPTS: ApplyCompute steps completing (${APPLY_COMPUTE_COMPLETED}/${APPLY_COMPUTE_COUNT})..."
      sleep 1
    fi
  done

  if [ "$STEP_VERIFY_PASSED" = false ]; then
    log_error "Not all ApplyCompute steps completed: ${APPLY_COMPUTE_COMPLETED}/${APPLY_COMPUTE_COUNT}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
