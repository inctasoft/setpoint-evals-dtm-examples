#!/bin/bash

# E2E Eval 02: Transient Failure Recovery
# Tests retry mechanism and recovery from transient failures

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
source "${REPO_ROOT}/workflows/order-processing/ste/shared/helpers.sh"

echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           Eval 02: Transient Failure Recovery                     ║${NC}"
echo -e "${CYAN}╠════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║ Test system's ability to recover from transient failures          ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}ℹ️  Expected Duration: ~130 seconds (with 30s SQS visibility timeout)${NC}"
echo -e "${CYAN}ℹ️  Expected Outcome: Job COMPLETES after retries${NC}"
echo ""

# Validate environment
echo -e "${CYAN}ℹ️  Validating environment variables...${NC}"
validate_env_for_ste

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 1: INITIATE JOB WITH TRANSIENT FAILURES${NC}"
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
    "ValidateCustomer": { "simDelay": 500, "failOnAttempts": [1, 2], "failureAfter": 100 },
    "ValidateProduct": { "simDelay": 500 },
    "SubmitCustomer": { "simDelay": 500, "ackDelay": 1000 },
    "SubmitOrder": { "simDelay": 500, "failOnAttempts": [1, 2], "failureAfter": 100, "ackDelay": 1000 }
  }
}
EOF
)

echo -e "${CYAN}ℹ️  Configuration:${NC}"
echo -e "${CYAN}   • ValidateCustomer: Will fail on attempts 1 & 2, succeed on attempt 3${NC}"
echo -e "${CYAN}   • SubmitOrder: Will fail on attempts 1 & 2, succeed on attempt 3${NC}"
echo -e "${CYAN}   • ValidateProduct: Will succeed on attempt 1${NC}"
echo -e "${CYAN}   • SubmitCustomer: Will succeed on attempt 1${NC}"
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
echo -e "  ${YELLOW}Phase 1: Validate Steps (30s visibility timeout)${NC}"
echo -e "  ${CYAN}t=0s${NC}    ValidateCustomer (Att 1) + ValidateProduct (Att 1) start"
echo -e "  ${CYAN}t=2s${NC}    ValidateCustomer fails ❌ (Att 1) → ${YELLOW}IN_PROGRESS_RETRYING${NC}"
echo -e "  ${CYAN}t=2s${NC}    ValidateProduct succeeds ✅"
echo -e "  ${CYAN}t=~32s${NC}  ValidateCustomer fails ❌ (Att 2) → ${YELLOW}IN_PROGRESS_RETRYING${NC}"
echo -e "  ${CYAN}t=~64s${NC}  ValidateCustomer succeeds ✅ (Att 3) → ${GREEN}COMPLETED${NC}"
echo ""
echo -e "  ${YELLOW}Phase 2: Submit Steps${NC}"
echo -e "  ${CYAN}t=~66s${NC}  SubmitCustomer (Att 1) + SubmitOrder (Att 1)"
echo -e "  ${CYAN}t=~68s${NC}  SubmitCustomer succeeds ✅ → ${YELLOW}WAITING_FOR_ACK${NC}"
echo -e "  ${CYAN}t=~68s${NC}  SubmitOrder fails ❌ (Att 1) → ${YELLOW}IN_PROGRESS_RETRYING${NC}"
echo -e "  ${CYAN}t=~70s${NC}  SubmitCustomer ack received → ${GREEN}COMPLETED${NC}"
echo -e "  ${CYAN}t=~100s${NC} SubmitOrder fails ❌ (Att 2) → ${YELLOW}IN_PROGRESS_RETRYING${NC}"
echo -e "  ${CYAN}t=~132s${NC} SubmitOrder succeeds ✅ (Att 3) → ${YELLOW}WAITING_FOR_ACK${NC}"
echo -e "  ${CYAN}t=~134s${NC} SubmitOrder ack received → ${GREEN}COMPLETED${NC}"
echo ""
echo -e "  ${CYAN}t=~134s${NC} ${GREEN}All steps complete → COMPLETED ✅${NC}"
echo ""
echo -e "  ${BLUE}Total: 2 + 30 + 2 + 30 + 2 + 2 + 30 + 2 + 30 + 2 + delays = ~134s${NC}"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}MONITORING PROGRESS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}💡 TIP: Open additional terminals to monitor:${NC}"
echo -e "   ${CYAN}./scripts/local-env.sh monitor sqs${NC}  ${BLUE}(watch retry counts)${NC}"
echo -e "   ${CYAN}./scripts/local-env.sh logs validate-customer-worker${NC}"
echo -e "   ${CYAN}./scripts/local-env.sh logs submit-order-worker${NC}"
echo ""

# Poll with extra buffer for SQS retries and processing delays
# Expected: ~134s, but LocalStack/SQS delays can add 10-20s
poll_job "$JOB_ID" 200 2  # 400s total (provides safe margin for retries)

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 2: VERIFY RETRY COUNTS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Get step details from database
echo -e "${BLUE}▶  Querying database for retry counts...${NC}"

RETRY_COUNTS=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db sh -c "psql -U dtm_user -d dtm -t -c \"
SELECT
  step_value,
  retry_count,
  status
FROM dtm_steps
WHERE job_id = '${JOB_ID}'
ORDER BY step_value;
\" 2>&1" | grep -v "^$")

echo "$RETRY_COUNTS"
echo ""

# Parse retry counts (quick-order variant: ValidateCustomer, SubmitCustomer, ValidateOrder, SubmitOrder)
EC_RETRY=$(echo "$RETRY_COUNTS" | grep "ValidateCustomer" | awk '{print $3}')
TC_RETRY=$(echo "$RETRY_COUNTS" | grep "SubmitCustomer" | awk '{print $3}')
TO_RETRY=$(echo "$RETRY_COUNTS" | grep "SubmitOrder" | awk '{print $3}')

# Validate retry counts
# NOTE: retry_count stores ATTEMPT NUMBER (1, 2, 3...), not number of retries (0, 1, 2...)
# So if a step succeeds on attempt 3 (after 2 failures), retry_count = 3
RETRY_CHECK_PASSED=true

if [ "$EC_RETRY" != "3" ]; then
  echo -e "${RED}❌ ValidateCustomer retry_count = ${EC_RETRY} (expected 3 - attempt 3 after 2 failures)${NC}"
  RETRY_CHECK_PASSED=false
else
  echo -e "${GREEN}✅ ValidateCustomer retry_count = 3 (attempt 3 after 2 failures)${NC}"
fi

if [ "$TC_RETRY" != "1" ]; then
  echo -e "${RED}❌ SubmitCustomer retry_count = ${TC_RETRY} (expected 1 - succeeded on first attempt)${NC}"
  RETRY_CHECK_PASSED=false
else
  echo -e "${GREEN}✅ SubmitCustomer retry_count = 1 (succeeded on first attempt)${NC}"
fi

if [ "$TO_RETRY" != "3" ]; then
  echo -e "${RED}❌ SubmitOrder retry_count = ${TO_RETRY} (expected 3 - attempt 3 after 2 failures)${NC}"
  RETRY_CHECK_PASSED=false
else
  echo -e "${GREEN}✅ SubmitOrder retry_count = 3 (attempt 3 after 2 failures)${NC}"
fi

echo ""

if [ "$RETRY_CHECK_PASSED" = false ]; then
  echo -e "${RED}❌ Retry count validation FAILED${NC}"
  exit 1
fi

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 3: VERIFY ERROR FIELD CLEARED${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}▶  Checking error fields after successful retry...${NC}"

ERROR_CHECK=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db sh -c "psql -U dtm_user -d dtm -t -c \"
SELECT
  step_value,
  CASE WHEN error IS NULL THEN 'cleared' ELSE 'not_cleared' END as error_status
FROM dtm_steps
WHERE job_id = '${JOB_ID}'
  AND retry_count > 0
ORDER BY step_value;
\" 2>&1" | grep -v "^$")

echo "$ERROR_CHECK"
echo ""

if echo "$ERROR_CHECK" | grep -q "not_cleared"; then
  echo -e "${RED}❌ Error field not cleared after successful retry${NC}"
  exit 1
else
  echo -e "${GREEN}✅ Error fields cleared for all retried steps${NC}"
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 4: VERIFY EXECUTION HISTORY${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}▶  Checking execution history for retried steps...${NC}"

HISTORY_COUNT=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db sh -c "psql -U dtm_user -d dtm -t -c \"
SELECT
  step_value,
  jsonb_array_length(execution_history) as attempt_count
FROM dtm_steps
WHERE job_id = '${JOB_ID}'
  AND retry_count > 0
ORDER BY step_value;
\" 2>&1" | grep -v "^$")

echo "$HISTORY_COUNT"
echo ""

# Each retried step should have 3 attempts in history
EC_HISTORY=$(echo "$HISTORY_COUNT" | grep "ValidateCustomer" | awk '{print $3}')
TO_HISTORY=$(echo "$HISTORY_COUNT" | grep "SubmitOrder" | awk '{print $3}')

HISTORY_CHECK_PASSED=true

if [ "$EC_HISTORY" != "3" ]; then
  echo -e "${RED}❌ ValidateCustomer has ${EC_HISTORY} execution history entries (expected 3)${NC}"
  HISTORY_CHECK_PASSED=false
else
  echo -e "${GREEN}✅ ValidateCustomer has 3 execution history entries${NC}"
fi

if [ "$TO_HISTORY" != "3" ]; then
  echo -e "${RED}❌ SubmitOrder has ${TO_HISTORY} execution history entries (expected 3)${NC}"
  HISTORY_CHECK_PASSED=false
else
  echo -e "${GREEN}✅ SubmitOrder has 3 execution history entries${NC}"
fi

echo ""

if [ "$HISTORY_CHECK_PASSED" = false ]; then
  echo -e "${RED}❌ Execution history validation FAILED${NC}"
  exit 1
fi

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 5: JOB-LEVEL STATISTICS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}▶  Verifying final job statistics...${NC}"

FINAL_STATUS_JSON=$(get_job_status "$JOB_ID")
TOTAL_RECORDS=$(echo "$FINAL_STATUS_JSON" | jq -r '.result.totalRecords')
STEPS_COMPLETED=$(echo "$FINAL_STATUS_JSON" | jq -r '.result.stepsCompleted')

# Expected: 2 Records (quick-order variant has 4 steps)
# Expected: 4 Steps (ValidateCustomer, SubmitCustomer, ValidateOrder, SubmitOrder)
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
echo -e "${GREEN}✅ Retry counts verified (ValidateCustomer: 2, SubmitOrder: 2)${NC}"
echo -e "${GREEN}✅ Error fields cleared after successful retries${NC}"
echo -e "${GREEN}✅ Execution history validated (3 attempts each)${NC}"
echo ""
echo -e "${GREEN}🎉 Eval 02: Transient Failure Recovery PASSED${NC}"
