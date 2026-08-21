#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 09: Long-But-Legit ACK Wait vs Genuinely Stuck ACK
# ═══════════════════════════════════════════════════════════════════════════
# docs/guides/MAINTENANCE-TASKS.md's stuck-acknowledgement task auto-fails a
# step that has been WAITING_FOR_ACK longer than ackTimeoutMinutes. This SE
# proves the DISCRIMINATOR is genuinely time-based, not "any pending ACK
# gets reaped": a long-but-legit wait, still under the threshold when
# maintenance runs, is left ALONE; only a genuinely stuck one (its ACK will
# never arrive) is auto-failed.
#
#   Part A (legit): ApplyEnvironment's ACK is delayed 8s (still real, will
#     arrive). Maintenance is triggered ~2-3s in with a 60s threshold — far
#     more than has elapsed — so it must find/fix ZERO steps for this job.
#     The job then completes normally once the ACK legitimately arrives.
#
#   Part B (stuck): ApplyEnvironment uses skipAck=true (ACK will NEVER
#     arrive — non-destructive simulation, no service killed, same
#     mechanism as core SE-07-stuck-ack-recovery). After a short real wait,
#     maintenance is triggered with a SHORT threshold that the elapsed wait
#     DOES exceed -> the step is auto-failed, and since environment is a
#     required cascade, the job reaches FAILED.
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

EVAL_NAME="SE 09: Long-But-Legit ACK Wait vs Genuinely Stuck ACK"
EVAL_PURPOSE="threshold-based reaping: legit wait untouched, genuinely stuck one auto-failed"

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

PASS_COUNT=0
FAIL_COUNT=0

# ═══════════════════════════════════════════════════════════════════════════
# Part A: long-but-legit ACK wait, well under the maintenance threshold
# ═══════════════════════════════════════════════════════════════════════════

log_section "PART A: long-but-legit ACK wait (must NOT be reaped)"

PAYLOAD_A='{
  "variant": "default",
  "enableDeduplication": false,
  "payload": {
    "environmentId": "prod-eu",
    "networkId": "NET-PROD-EU-1",
    "instanceId": "INST-PROD-EU-1",
    "dnsRecordId": "DNS-PROD-EU-1",
    "certificateId": "CERT-PROD-EU-1",
    "loadBalancerId": "LB-PROD-EU-1",
    "entityId": "prod-eu-legit-ack-wait"
  },
  "testOptions": {
    "PlanEnvironment":    { "simDelay": 300 },
    "ApplyEnvironment":   { "simDelay": 300, "ackDelay": 8000 },
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

IFS=':' read -r JOB_ID_A CORRELATION_ID_A <<< "$(initiate_job "$PAYLOAD_A")"
validate_job_id "$JOB_ID_A" || exit 1

log_info "Waiting for ApplyEnvironment to reach WAITING_FOR_ACK (its 8s ACK hasn't landed yet)..."
ATTEMPT=0
AE_WAITING=false
while [ $ATTEMPT -lt 20 ]; do
  ATTEMPT=$((ATTEMPT + 1))
  AE_STATUS=$(extract_step_status "$(get_job_status "$JOB_ID_A")" "ApplyEnvironment")
  if [ "${AE_STATUS,,}" == "waiting_for_ack" ]; then
    AE_WAITING=true
    break
  fi
  sleep 1
done

if [ "$AE_WAITING" != true ]; then
  log_error "Part A: ApplyEnvironment never reached WAITING_FOR_ACK in time"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  log_success "Part A: ApplyEnvironment is WAITING_FOR_ACK (legit — ACK arrives at ~8s)"

  log_info "Triggering maintenance task with a 60-minute threshold (elapsed wait is only a few seconds)..."
  TASK_RESULT_A=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d '{"ackTimeoutMinutes": 60}' \
    "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/stuck-acknowledgement/execute")
  HTTP_CODE_A=$(echo "$TASK_RESULT_A" | grep "HTTP_CODE:" | cut -d: -f2)
  TASK_BODY_A=$(echo "$TASK_RESULT_A" | sed '/HTTP_CODE:/d')

  if [ "$HTTP_CODE_A" == "200" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "Part A: maintenance task HTTP error: $HTTP_CODE_A"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  AE_STATUS_AFTER=$(extract_step_status "$(get_job_status "$JOB_ID_A")" "ApplyEnvironment")
  if [ "${AE_STATUS_AFTER,,}" == "waiting_for_ack" ]; then
    log_success "Part A: ApplyEnvironment is STILL WAITING_FOR_ACK — the 60-minute threshold correctly left it alone"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "Part A: expected ApplyEnvironment to remain waiting_for_ack, got '$AE_STATUS_AFTER' — maintenance reaped a legit wait!"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
fi

log_info "Letting Part A's job finish naturally (its 8s ACK will land for real)..."
poll_job "$JOB_ID_A" 300 5

if verify_job_status "$JOB_ID_A" "COMPLETED"; then
  log_success "Part A: job completed normally once its legit ACK arrived"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part A: expected job to complete normally"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Part B: genuinely stuck ACK (skipAck — non-destructive; ACK will never arrive)
# ═══════════════════════════════════════════════════════════════════════════

log_section "PART B: genuinely stuck ACK (must be auto-failed)"

PAYLOAD_B='{
  "variant": "default",
  "enableDeduplication": false,
  "payload": {
    "environmentId": "prod-eu",
    "networkId": "NET-PROD-EU-1",
    "instanceId": "INST-PROD-EU-1",
    "dnsRecordId": "DNS-PROD-EU-1",
    "certificateId": "CERT-PROD-EU-1",
    "loadBalancerId": "LB-PROD-EU-1",
    "entityId": "prod-eu-genuinely-stuck"
  },
  "testOptions": {
    "PlanEnvironment":  { "simDelay": 300 },
    "ApplyEnvironment": { "simDelay": 300, "skipAck": true }
  }
}'

IFS=':' read -r JOB_ID_B CORRELATION_ID_B <<< "$(initiate_job "$PAYLOAD_B")"
validate_job_id "$JOB_ID_B" || exit 1

log_info "Waiting for ApplyEnvironment to reach WAITING_FOR_ACK (skipAck=true — will never arrive)..."
ATTEMPT=0
AE_B_WAITING=false
while [ $ATTEMPT -lt 20 ]; do
  ATTEMPT=$((ATTEMPT + 1))
  AE_B_STATUS=$(extract_step_status "$(get_job_status "$JOB_ID_B")" "ApplyEnvironment")
  if [ "${AE_B_STATUS,,}" == "waiting_for_ack" ]; then
    AE_B_WAITING=true
    break
  fi
  sleep 1
done

if [ "$AE_B_WAITING" != true ]; then
  log_error "Part B: ApplyEnvironment never reached WAITING_FOR_ACK in time"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
fi
log_success "Part B: ApplyEnvironment is WAITING_FOR_ACK (skipAck=true, will never arrive)"

log_info "Waiting 8s for the wait to become 'stuck' relative to a short threshold..."
sleep 8

log_info "Triggering maintenance task with a 0.1-minute (6s) threshold — the 8s elapsed wait EXCEEDS it..."
TASK_RESULT_B=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{"ackTimeoutMinutes": 0.1}' \
  "${ORCHESTRATOR_HOST}/api/${API_VERSION}/maintenance/tasks/stuck-acknowledgement/execute")
HTTP_CODE_B=$(echo "$TASK_RESULT_B" | grep "HTTP_CODE:" | cut -d: -f2)
TASK_BODY_B=$(echo "$TASK_RESULT_B" | sed '/HTTP_CODE:/d')

if [ "$HTTP_CODE_B" == "200" ]; then
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part B: maintenance task HTTP error: $HTTP_CODE_B"
  echo "   Response: $TASK_BODY_B"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

STEPS_FIXED_B=$(echo "$TASK_BODY_B" | jq -r '.metrics.autoFixed // 0')
if [ "$STEPS_FIXED_B" -ge 1 ]; then
  log_success "Part B: maintenance task auto-fixed $STEPS_FIXED_B stuck step(s)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part B: expected at least 1 auto-fixed step, got $STEPS_FIXED_B"
  echo "   Response: $TASK_BODY_B"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_step_status "$JOB_ID_B" "ApplyEnvironment" "FAILED"; then
  log_success "Part B: ApplyEnvironment is FAILED (auto-failed by maintenance)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part B: expected ApplyEnvironment to be FAILED"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

if verify_job_status "$JOB_ID_B" "FAILED"; then
  log_success "Part B: job is FAILED (environment is a required cascade)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Part B: expected job to be FAILED"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
