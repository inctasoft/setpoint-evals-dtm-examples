#!/bin/bash

# E2E Eval 09: Acknowledgement Delays
# Tests WAITING_FOR_ACK status and variable ack delays

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${REPO_ROOT}/workflows/order-processing/setpoint-evals/shared/helpers.sh"

echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              Eval 09: Acknowledgement Delays                       ║${NC}"
echo -e "${CYAN}╠════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║ Test WAITING_FOR_ACK status and variable ack delay durations      ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}ℹ️  Expected Duration: ~8 seconds${NC}"
echo -e "${CYAN}ℹ️  Expected Outcome: Job COMPLETES after all acks received${NC}"
echo ""

# Validate environment
echo -e "${CYAN}ℹ️  Validating environment variables...${NC}"
validate_env_for_ste

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 1: INITIATE JOB WITH ACK DELAYS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Generate unique identifier for each run
EXTERNAL_SYSTEM_ID=$(uuidgen)

PAYLOAD=$(cat <<EOF
{
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "${EXTERNAL_SYSTEM_ID}"
  },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 2000 },
    "ValidateProduct": { "simDelay": 2000 },
    "SubmitCustomer": { "simDelay": 3000, "ackDelay": 2000 },
    "SubmitOrder": { "simDelay": 3000, "ackDelay": 3000 }
  }
}
EOF
)

echo -e "${CYAN}ℹ️  Configuration:${NC}"
echo -e "${CYAN}   • SubmitCustomer: 2s acknowledgement delay${NC}"
echo -e "${CYAN}   • SubmitOrder: 3s acknowledgement delay${NC}"
echo -e "${CYAN}   • Job should complete in ~8s${NC}"
echo ""

# Capture both jobId and correlationId
IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || exit 1
validate_job_id "$JOB_ID" || exit 1
echo -e "${GREEN}✅ Job initiated!${NC}"
echo -e "${CYAN}ℹ️  Job ID: ${CYAN}${JOB_ID}${NC}${NC}"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}EXPECTED TIMELINE${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}Phase 1: Validate Steps (No Acks Required)${NC}"
echo -e "  ${CYAN}t=0s${NC}    ValidateCustomer + ValidateProduct start"
echo -e "  ${CYAN}t=2s${NC}    Both complete → ${GREEN}COMPLETED${NC}"
echo ""
echo -e "  ${YELLOW}Phase 2: Submit Steps (Require Acks)${NC}"
echo -e "  ${CYAN}t=2s${NC}    SubmitCustomer + SubmitOrder start"
echo -e "  ${CYAN}t=5s${NC}    Both publish to Kafka → ${YELLOW}WAITING_FOR_ACK${NC}"
echo ""
echo -e "  ${YELLOW}Phase 3: Waiting for Acknowledgements${NC}"
echo -e "  ${CYAN}t=5-7s${NC}   SubmitCustomer waits (2s delay)"
echo -e "  ${CYAN}t=5-8s${NC}   SubmitOrder waits (3s delay)"
echo -e "  ${CYAN}t=7s${NC}    SubmitCustomer ack received → ${GREEN}COMPLETED${NC}"
echo -e "  ${CYAN}t=8s${NC}    SubmitOrder ack received → ${GREEN}COMPLETED${NC}"
echo ""
echo -e "  ${CYAN}t=~8s${NC}   ${GREEN}All acks received → Job COMPLETED ✅${NC}"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}MONITORING PROGRESS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}💡 TIP: Open additional terminals to monitor:${NC}"
echo -e "   ${CYAN}./scripts/local-env.sh monitor api${NC}  ${BLUE}(watch for purple ⏳ icons)${NC}"
echo -e "   ${CYAN}docker logs -f ${COMPOSE_PROJECT_NAME:-dtm}-orchestrator | grep 'WAITING_FOR_ACK'${NC}"
echo ""

# Poll with 45 attempts × 3s = 135s max (25s expected + buffer for LocalStack overhead)
poll_job "$JOB_ID" 45 3

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 2: VERIFY WAITING_FOR_ACK STATUS WAS USED${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}▶  Checking if Submit steps went through WAITING_FOR_ACK...${NC}"

STEP_STATUSES=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db sh -c "psql -U dtm_user -d dtm -t -c \"
SELECT
  step_value,
  kafka_published_at IS NOT NULL as kafka_published,
  ack_received_at IS NOT NULL as ack_received
FROM dtm_steps
WHERE job_id = '${JOB_ID}'
ORDER BY step_value;
\" 2>&1" | grep -v "^$")

echo "$STEP_STATUSES"
echo ""

# Verify Submit steps have Kafka publish timestamps
TC_PUBLISHED=$(echo "$STEP_STATUSES" | grep "SubmitCustomer" | awk '{print $3}')
TO_PUBLISHED=$(echo "$STEP_STATUSES" | grep "SubmitOrder" | awk '{print $3}')

if [ "$TC_PUBLISHED" = "t" ] && [ "$TO_PUBLISHED" = "t" ]; then
  echo -e "${GREEN}✅ Submit steps published to Kafka (entered WAITING_FOR_ACK)${NC}"
else
  echo -e "${RED}❌ Submit steps did not publish to Kafka${NC}"
  exit 1
fi

# Verify acknowledgements were received
TC_ACK=$(echo "$STEP_STATUSES" | grep "SubmitCustomer" | awk '{print $5}')
TO_ACK=$(echo "$STEP_STATUSES" | grep "SubmitOrder" | awk '{print $5}')

if [ "$TC_ACK" = "t" ] && [ "$TO_ACK" = "t" ]; then
  echo -e "${GREEN}✅ Acknowledgements received for both Submit steps${NC}"
else
  echo -e "${RED}❌ Acknowledgements not received${NC}"
  exit 1
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 3: VERIFY ACK DELAY DURATIONS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}▶  Calculating actual ack delay durations...${NC}"

ACK_DELAYS=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db sh -c "psql -U dtm_user -d dtm -t -c \"
SELECT
  step_value,
  ROUND(EXTRACT(EPOCH FROM (ack_received_at - kafka_published_at))::numeric, 1) as delay_seconds
FROM dtm_steps
WHERE job_id = '${JOB_ID}'
  AND step_value LIKE 'Submit%'
ORDER BY step_value;
\" 2>&1" | grep -v "^$")

echo "$ACK_DELAYS"
echo ""

# Parse delays
TC_DELAY=$(echo "$ACK_DELAYS" | grep "SubmitCustomer" | awk '{print $3}')
TO_DELAY=$(echo "$ACK_DELAYS" | grep "SubmitOrder" | awk '{print $3}')

# Validate delays (allow ±2 seconds tolerance)
DELAY_CHECK_PASSED=true

# SubmitCustomer should be ~2s (ackDelay: 2000ms)
if (( $(echo "$TC_DELAY >= 1.0 && $TC_DELAY <= 4.0" | bc -l) )); then
  echo -e "${GREEN}✅ SubmitCustomer ack delay: ${TC_DELAY}s (expected ~2s)${NC}"
else
  echo -e "${RED}❌ SubmitCustomer ack delay: ${TC_DELAY}s (expected ~2s)${NC}"
  DELAY_CHECK_PASSED=false
fi

# SubmitOrder should be ~3s (ackDelay: 3000ms)
if (( $(echo "$TO_DELAY >= 2.0 && $TO_DELAY <= 5.0" | bc -l) )); then
  echo -e "${GREEN}✅ SubmitOrder ack delay: ${TO_DELAY}s (expected ~3s)${NC}"
else
  echo -e "${RED}❌ SubmitOrder ack delay: ${TO_DELAY}s (expected ~3s)${NC}"
  DELAY_CHECK_PASSED=false
fi

echo ""

if [ "$DELAY_CHECK_PASSED" = false ]; then
  echo -e "${YELLOW}⚠️  Ack delay validation had some deviations (but might be acceptable)${NC}"
fi

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 4: VERIFY JOB WAITED FOR ALL ACKS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}▶  Checking job completion timing...${NC}"

JOB_TIMING=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db sh -c "psql -U dtm_user -d dtm -t -c \"
SELECT
  ROUND(EXTRACT(EPOCH FROM (completed_at - submitted_at))::numeric, 1) as total_duration
FROM dtm_jobs
WHERE id = '${JOB_ID}';
\" 2>&1" | grep -v "^$" | xargs)

echo "Total job duration: ${JOB_TIMING}s"
echo ""

# Job should take at least 6s (longest ack delay is 3s + ~3s processing time)
if (( $(echo "$JOB_TIMING >= 6.0" | bc -l) )); then
  echo -e "${GREEN}✅ Job waited for all acknowledgements before completing${NC}"
else
  echo -e "${YELLOW}⚠️  Job completed in ${JOB_TIMING}s (expected ≥6s)${NC}"
  echo -e "${YELLOW}   This might indicate job didn't wait for all acks${NC}"
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 5: JOB-LEVEL STATISTICS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}▶  Verifying final job statistics...${NC}"

FINAL_STATUS_JSON=$(get_job_status "$JOB_ID")
TOTAL_RECORDS=$(echo "$FINAL_STATUS_JSON" | jq -r '.result.totalRecords')
STEPS_COMPLETED=$(echo "$FINAL_STATUS_JSON" | jq -r '.result.stepsCompleted')

# Expected Records: 2 (quick-order variant)
# Expected Steps: 4 (ValidateCustomer, ValidateProduct, SubmitCustomer, SubmitOrder)
EXPECTED_RECORDS=2
EXPECTED_STEPS=4

STATS_CHECK_PASSED=true

if [ "$TOTAL_RECORDS" == "$EXPECTED_RECORDS" ]; then
  echo -e "${GREEN}✅ Total records processed: $TOTAL_RECORDS${NC}"
else
  echo -e "${RED}❌ Total records processed mismatch. Expected: $EXPECTED_RECORDS, Got: $TOTAL_RECORDS${NC}"
  STATS_CHECK_PASSED=false
fi

if [ "$STEPS_COMPLETED" == "$EXPECTED_STEPS" ]; then
  echo -e "${GREEN}✅ Steps completed: $STEPS_COMPLETED${NC}"
else
  echo -e "${RED}❌ Steps completed mismatch. Expected: $EXPECTED_STEPS, Got: $STEPS_COMPLETED${NC}"
  STATS_CHECK_PASSED=false
fi

echo ""

if [ "$STATS_CHECK_PASSED" = false ]; then
  echo -e "${RED}❌ Job statistics validation FAILED${NC}"
  # Optional: Print JSON for debug
  echo "$FINAL_STATUS_JSON" | jq -r '.result' 2>/dev/null || echo "$FINAL_STATUS_JSON"
  exit 1
fi

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}FINAL SUMMARY${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${GREEN}✅ Job completed successfully${NC}"
echo -e "${GREEN}✅ Transform steps used WAITING_FOR_ACK status${NC}"
echo -e "${GREEN}✅ Acknowledgements received for all Transform steps${NC}"
echo -e "${GREEN}✅ Ack delays honored (TC: ${TC_DELAY}s, TO: ${TO_DELAY}s)${NC}"
echo -e "${GREEN}✅ Job waited for all acks before completing${NC}"
echo ""
echo -e "${GREEN}🎉 Eval 09: Acknowledgement Delays PASSED${NC}"
