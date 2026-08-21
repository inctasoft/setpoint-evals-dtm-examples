#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 01: Happy Path
# ═══════════════════════════════════════════════════════════════════════════
# Verifies the standard end-to-end infra-provisioning flow:
#   1. Initiate a job with payload.entityId="staging-eu" — dedicated to this SE
#      (staging-eu's instance 1 chain — see ../../source-db/SEED-REGISTRY.md)
#   2. All plan/apply steps complete successfully through the full
#      cascade: Environment -> Network -> Compute (fan-out) -> Storage,
#      DNS -> Certificate, LoadBalancer
#   3. Job reaches COMPLETED status
#
# Uses the "default" variant (full provisioning workflow with all entities).
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 01: Happy Path"
EVAL_PURPOSE="Test standard successful infra-provisioning with default variant"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: staging-eu (INST-STAGING-EU-1 chain)"
log_info "Variant: default"
log_info "Expected Outcome: Job COMPLETES successfully (all steps pass)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB"

PAYLOAD='{
  "variant": "default",
  "payload": {
    "environmentId": "staging-eu",
    "networkId": "NET-STAGING-EU-1",
    "instanceId": "INST-STAGING-EU-1",
    "dnsRecordId": "DNS-STAGING-EU-1",
    "certificateId": "CERT-STAGING-EU-1",
    "loadBalancerId": "LB-STAGING-EU-1",
    "entityId": "staging-eu"
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

# Test 2: PlanEnvironment should be COMPLETED
if verify_step_status "$JOB_ID" "PlanEnvironment" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: ApplyEnvironment should be COMPLETED
if verify_step_status "$JOB_ID" "ApplyEnvironment" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: PlanNetwork should be COMPLETED
if verify_step_status "$JOB_ID" "PlanNetwork" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 5: ApplyNetwork should be COMPLETED
if verify_step_status "$JOB_ID" "ApplyNetwork" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 6: DiscoverCompute should be COMPLETED
if verify_step_status "$JOB_ID" "DiscoverCompute" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
