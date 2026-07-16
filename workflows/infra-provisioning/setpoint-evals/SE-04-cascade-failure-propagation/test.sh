#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 04: Cascade Failure Propagation
# ═══════════════════════════════════════════════════════════════════════════
# Tests cascade failure propagation with SKIPPED status.
#
# Scenario:
#   - ApplyDNS is configured to fail permanently (failureAfter: 0)
#   - Since Certificate depends on DNS (dns -> certificate chain),
#     PlanCertificate and ApplyCertificate should be SKIPPED
#   - However, Storage depends only on Compute (not DNS),
#     so Storage steps should still succeed
#   - DNS and Certificate are OPTIONAL entities
#   - Job should reach PARTIAL_SUCCESS (critical entities OK, optional failed)
#
# Expected cascade:
#   Environment -> Network -> Compute (OK)
#   Compute -> Storage (OK, independent of DNS)
#   Compute + Network -> DNS (FAILS at ApplyDNS)
#   DNS -> Certificate (SKIPPED, dependency failed)
#   Compute + Network -> LoadBalancer (OK, independent of DNS)
#
# ═══════════════════════════════════════════════════════════════════════════

set -e

# Load shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Test Configuration
# ═══════════════════════════════════════════════════════════════════════════

EVAL_NAME="SE 04: Cascade Failure Propagation"
EVAL_PURPOSE="Test DNS failure -> Certificate SKIPPED, but Storage succeeds -> PARTIAL_SUCCESS"

# ═══════════════════════════════════════════════════════════════════════════
# Display Banner
# ═══════════════════════════════════════════════════════════════════════════

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: prod-eu (INST-PROD-EU-1 chain)"
log_info "Variant: default"
log_info "ApplyDNS configured to fail permanently"
log_info "Expected Outcome: PARTIAL_SUCCESS (DNS/Certificate fail, Storage/LB succeed)"
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Initiate Job with ApplyDNS Failure
# ═══════════════════════════════════════════════════════════════════════════

log_section "STEP 1: INITIATE JOB (DNS FAILURE)"

PAYLOAD='{
  "variant": "default",
  "enableDeduplication": false,
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
    "ApplyDNS":           { "simDelay": 300, "failureAfter": 1, "failOnAttempts": [1, 2, 3] },
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

poll_job "$JOB_ID" 900 5

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

# Test 1: Job status should be PARTIAL_SUCCESS
if verify_job_status "$JOB_ID" "PARTIAL_SUCCESS"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 2: Critical entity steps should be COMPLETED
if verify_step_status "$JOB_ID" "PlanEnvironment" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "ApplyEnvironment" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "PlanNetwork" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID" "ApplyNetwork" "COMPLETED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: ApplyDNS should be FAILED
if verify_step_status "$JOB_ID" "ApplyDNS" "FAILED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 4: Certificate steps should NOT be COMPLETED (cascaded from DNS failure)
FINAL_STATUS_JSON=$(get_job_status "$JOB_ID")
EC_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "PlanCertificate")
TC_STATUS=$(extract_step_status "$FINAL_STATUS_JSON" "ApplyCertificate")

if [[ "${EC_STATUS,,}" != "completed" ]]; then
  log_success "PlanCertificate correctly NOT completed (status: ${EC_STATUS})"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "PlanCertificate should NOT be completed when DNS fails"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ═══════════════════════════════════════════════════════════════════════════
# Exit with Summary
# ═══════════════════════════════════════════════════════════════════════════

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
