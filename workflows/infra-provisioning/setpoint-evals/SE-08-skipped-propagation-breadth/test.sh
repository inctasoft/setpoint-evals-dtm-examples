#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 08: Skipped Propagation Breadth
# ═══════════════════════════════════════════════════════════════════════════
# SE-04 already pins DEPTH: DNS fails -> Certificate (its one dependent) is
# SKIPPED. This SE pins BREADTH + depth together, by failing a step with
# THREE direct dependents instead of one:
#
#   compute (dependsOn: network) has three direct dependents:
#     dns          (dependsOn: [network, compute])
#     loadBalancer (dependsOn: [network, compute])
#     storage      (dependsOn: [compute])
#   and one TRANSITIVE dependent, two hops from compute:
#     certificate  (dependsOn: [dns])
#
# ApplyCompute is forced to fail on every attempt for every fanned-out
# compute instance (compute is a REQUIRED cascade -> job FAILED). Expected:
#   - dns, loadBalancer, storage: ALL SKIPPED (breadth — 3 siblings, same
#     failed parent)
#   - certificate: SKIPPED (depth — dependent on a SKIPPED step, not a
#     directly failed one)
#   - environment, network: still COMPLETED (siblings/upstream of compute,
#     unaffected)
#
# Uses the same seeded chain as SE-01/SE-04 (prod-eu / NET-PROD-EU-1 /
# INST-PROD-EU-1 / DNS-PROD-EU-1 / CERT-PROD-EU-1 / LB-PROD-EU-1) — this SE
# is read-only against those rows, distinguished by its own entityId.
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

EVAL_NAME="SE 08: Skipped Propagation Breadth"
EVAL_PURPOSE="compute fails -> dns+loadBalancer+storage SKIPPED (breadth), certificate SKIPPED (depth)"

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

log_info "Entity ID: prod-eu (INST-PROD-EU-1 chain)"
log_info "ApplyCompute configured to fail permanently (all fanned-out instances)"
log_info "Expected Outcome: FAILED — 3 direct dependents + 1 transitive dependent SKIPPED"
echo ""

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
    "entityId": "prod-eu-compute-breadth"
  },
  "testOptions": {
    "PlanEnvironment":    { "simDelay": 300 },
    "ApplyEnvironment":   { "simDelay": 300, "ackDelay": 1000 },
    "PlanNetwork":        { "simDelay": 300 },
    "ApplyNetwork":       { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverCompute":    { "simDelay": 300 },
    "PlanCompute":        { "simDelay": 300 },
    "ApplyCompute":       { "simDelay": 300, "failOnAttempts": [1, 2, 3] },
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

log_section "MONITORING PROGRESS"
poll_job "$JOB_ID" 900 5

display_results "$JOB_ID"

log_section "VERIFICATION"

PASS_COUNT=0
FAIL_COUNT=0

if verify_job_status "$JOB_ID" "FAILED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

JOB_DETAILS=$(get_job_status "$JOB_ID")
FAILED_COMPUTE=$(echo "$JOB_DETAILS" | jq '[.steps[] | select(.stepNumber == "ApplyCompute" and .status == "failed")] | length')
if [ "$FAILED_COMPUTE" -ge 1 ]; then
  log_success "ApplyCompute failed as forced ($FAILED_COMPUTE instance(s))"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Expected at least 1 failed ApplyCompute, found $FAILED_COMPUTE"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

log_section "BREADTH: three direct dependents of compute, all SKIPPED"

for step in ApplyDNS ApplyLoadBalancer ApplyStorage; do
  if verify_step_status "$JOB_ID" "$step" "SKIPPED"; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

log_section "DEPTH: transitive dependent (certificate, via dns) also SKIPPED"

if verify_step_status "$JOB_ID" "ApplyCertificate" "SKIPPED"; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

log_section "SIBLINGS UNAFFECTED: environment and network still COMPLETED"

if verify_step_status "$JOB_ID" "ApplyEnvironment" "COMPLETED" && \
   verify_step_status "$JOB_ID" "ApplyNetwork" "COMPLETED"; then
  log_success "environment and network cascades unaffected by the compute failure"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "environment/network were unexpectedly affected"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
