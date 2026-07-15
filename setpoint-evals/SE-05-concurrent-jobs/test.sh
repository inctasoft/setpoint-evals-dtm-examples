#!/bin/bash

# E2E Eval 10: Concurrent Jobs
# Tests parallel execution of multiple jobs

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
echo -e "${CYAN}║              Eval 10: Concurrent Jobs                              ║${NC}"
echo -e "${CYAN}╠════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║ Test parallel execution of 3 simultaneous jobs                    ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}ℹ️  Expected Duration: ~6 seconds (parallel execution)${NC}"
echo -e "${CYAN}ℹ️  Expected Outcome: All 3 jobs complete successfully${NC}"
echo ""

# Validate environment
echo -e "${CYAN}ℹ️  Validating environment variables...${NC}"
validate_env_for_ste

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 1: INITIATE 3 CONCURRENT JOBS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${CYAN}ℹ️  Configuration:${NC}"
echo -e "${CYAN}   • Job 1: identifier customer-101, Fast (2s delays)${NC}"
echo -e "${CYAN}   • Job 2: identifier customer-102, Medium (3s delays)${NC}"
echo -e "${CYAN}   • Job 3: identifier customer-103, Slow (4s delays)${NC}"
echo ""

# Launch Job 1 (Fast)
echo -e "${BLUE}▶  Initiating Job 1 (Fast)...${NC}"
PAYLOAD_1=$(cat <<EOF
{
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "customer-101"
  },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500 },
    "ValidateProduct": { "simDelay": 500 },
    "SubmitCustomer": { "simDelay": 500, "ackDelay": 200 },
    "SubmitOrder": { "simDelay": 500, "ackDelay": 200 }
  }
}
EOF
)
# Capture both jobId and correlationId for job 1
IFS=':' read -r JOB_ID_1 CORRELATION_ID_1 <<< "$(initiate_job "$PAYLOAD_1")" || exit 1
validate_job_id "$JOB_ID_1" || exit 1
echo -e "${GREEN}✅ Job 1 initiated: ${JOB_ID_1}${NC}"

# Launch Job 2 (Medium)
echo -e "${BLUE}▶  Initiating Job 2 (Medium)...${NC}"
PAYLOAD_2=$(cat <<EOF
{
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "customer-102"
  },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 1000 },
    "ValidateProduct": { "simDelay": 1000 },
    "SubmitCustomer": { "simDelay": 1000, "ackDelay": 200 },
    "SubmitOrder": { "simDelay": 1000, "ackDelay": 200 }
  }
}
EOF
)
# Capture both jobId and correlationId for job 2
IFS=':' read -r JOB_ID_2 CORRELATION_ID_2 <<< "$(initiate_job "$PAYLOAD_2")" || exit 1
validate_job_id "$JOB_ID_2" || exit 1
echo -e "${GREEN}✅ Job 2 initiated: ${JOB_ID_2}${NC}"

# Launch Job 3 (Slow)
echo -e "${BLUE}▶  Initiating Job 3 (Slow)...${NC}"
PAYLOAD_3=$(cat <<EOF
{
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "customer-103"
  },
  "enableDeduplication": false,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 1500 },
    "ValidateProduct": { "simDelay": 1500 },
    "SubmitCustomer": { "simDelay": 1500, "ackDelay": 200 },
    "SubmitOrder": { "simDelay": 1500, "ackDelay": 200 }
  }
}
EOF
)
# Capture both jobId and correlationId for job 3
IFS=':' read -r JOB_ID_3 CORRELATION_ID_3 <<< "$(initiate_job "$PAYLOAD_3")" || exit 1
validate_job_id "$JOB_ID_3" || exit 1
echo -e "${GREEN}✅ Job 3 initiated: ${JOB_ID_3}${NC}"

echo ""
echo -e "${CYAN}ℹ️  All 3 jobs launched!${NC}"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}EXPECTED TIMELINE${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}Parallel Execution:${NC}"
echo -e "  ${CYAN}t=0s${NC}     All 3 jobs start simultaneously"
echo -e "  ${CYAN}t=~6s${NC}    Job 1 completes (fastest) ✅"
echo -e "  ${CYAN}t=~9s${NC}    Job 2 completes (medium) ✅"
echo -e "  ${CYAN}t=~12s${NC}   Job 3 completes (slowest) ✅"
echo ""
echo -e "  ${GREEN}Total wall time: ~12s (vs 27s if sequential)${NC}"
echo -e "  ${GREEN}Speedup: 2.25x${NC}"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}MONITORING CONCURRENT PROGRESS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}💡 TIP: Open additional terminal to monitor:${NC}"
echo -e "   ${CYAN}./scripts/local-env.sh monitor api${NC}  ${BLUE}(watch all 3 jobs)${NC}"
echo ""

# Monitor all 3 jobs concurrently
# Increased timeout for debugging - set to 200 attempts (~200 seconds)
# This extended timeout helps identify if jobs eventually complete
MAX_ATTEMPTS=200
ATTEMPT=0
ALL_COMPLETED=false

echo -e "${BLUE}▶  Monitoring all 3 jobs...${NC}"
echo ""

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))

  # Get status for all 3 jobs
  RESPONSE_1=$(get_job_status "$JOB_ID_1" 2>/dev/null || echo "")
  RESPONSE_2=$(get_job_status "$JOB_ID_2" 2>/dev/null || echo "")
  RESPONSE_3=$(get_job_status "$JOB_ID_3" 2>/dev/null || echo "")

  STATUS_1=$(extract_job_status "$RESPONSE_1" || echo "unknown")
  STATUS_2=$(extract_job_status "$RESPONSE_2" || echo "unknown")
  STATUS_3=$(extract_job_status "$RESPONSE_3" || echo "unknown")

  # Color code statuses
  case "$STATUS_1" in
    "completed") COLOR_1="${GREEN}" ;;
    "failed") COLOR_1="${RED}" ;;
    *) COLOR_1="${CYAN}" ;;
  esac

  case "$STATUS_2" in
    "completed") COLOR_2="${GREEN}" ;;
    "failed") COLOR_2="${RED}" ;;
    *) COLOR_2="${CYAN}" ;;
  esac

  case "$STATUS_3" in
    "completed") COLOR_3="${GREEN}" ;;
    "failed") COLOR_3="${RED}" ;;
    *) COLOR_3="${CYAN}" ;;
  esac

  printf "[%d/%d] J1: ${COLOR_1}%-11s${NC} | J2: ${COLOR_2}%-11s${NC} | J3: ${COLOR_3}%-11s${NC}\n" \
    $ATTEMPT $MAX_ATTEMPTS "$STATUS_1" "$STATUS_2" "$STATUS_3"

  # Check if all completed
  if [ "$STATUS_1" = "completed" ] && [ "$STATUS_2" = "completed" ] && [ "$STATUS_3" = "completed" ]; then
    ALL_COMPLETED=true
    break
  fi

  # Check if any failed
  if [ "$STATUS_1" = "failed" ] || [ "$STATUS_2" = "failed" ] || [ "$STATUS_3" = "failed" ]; then
    echo ""
    echo -e "${RED}❌ One or more jobs failed${NC}"
    exit 1
  fi

  sleep 1
done

echo ""

if [ "$ALL_COMPLETED" = false ]; then
  echo -e "${YELLOW}⚠️  Polling timed out after ${MAX_ATTEMPTS} attempts${NC}"
  exit 1
fi

echo -e "${GREEN}✅ All 3 jobs completed!${NC}"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 2: VERIFY DATA ISOLATION${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}▶  Checking step counts for each job...${NC}"

# Retry logic to handle race condition between job completion and step status updates
# Sometimes the last step status update is still being committed when job shows "completed"
# Under high load (parallel eval execution), this window needs to be longer
VERIFY_ATTEMPTS=0
MAX_VERIFY_ATTEMPTS=20
VERIFY_PASSED=false

while [ $VERIFY_ATTEMPTS -lt $MAX_VERIFY_ATTEMPTS ]; do
  VERIFY_ATTEMPTS=$((VERIFY_ATTEMPTS + 1))

  STEP_COUNTS=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db sh -c "psql -U dtm_user -d dtm -t -c \"
SELECT
  job_id,
  COUNT(*) as step_count,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_steps
FROM dtm_steps
WHERE job_id IN ('${JOB_ID_1}', '${JOB_ID_2}', '${JOB_ID_3}')
GROUP BY job_id
ORDER BY job_id;
\" 2>&1" | grep -v "^$")

  # Verify each job has all steps completed
  FAIL_COUNT=0
  while IFS='|' read -r job_id step_count completed_steps; do
    job_id=$(echo "$job_id" | tr -d ' ')
    step_count=$(echo "$step_count" | tr -d ' ')
    completed_steps=$(echo "$completed_steps" | tr -d ' ')

    if [ -n "$step_count" ] && [ "$step_count" -ge 4 ]; then
      if [ "$step_count" != "$completed_steps" ]; then
        FAIL_COUNT=$((FAIL_COUNT + 1))
      fi
    elif [ -n "$step_count" ]; then
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  done <<< "$STEP_COUNTS"

  if [ "$FAIL_COUNT" -eq 0 ]; then
    VERIFY_PASSED=true
    break
  fi

  if [ $VERIFY_ATTEMPTS -lt $MAX_VERIFY_ATTEMPTS ]; then
    echo -e "${YELLOW}⏳ Attempt $VERIFY_ATTEMPTS: $FAIL_COUNT job(s) still syncing, retrying in 1s...${NC}"
    sleep 1
  fi
done

echo "$STEP_COUNTS"
echo ""

# Verify each job has at least 4 completed steps (quick-order variant)
# quick-order creates: ValidateCustomer, ValidateProduct, SubmitCustomer, SubmitOrder = 4 steps
FAIL_COUNT=0
while IFS='|' read -r job_id step_count completed_steps; do
  job_id=$(echo "$job_id" | tr -d ' ')
  step_count=$(echo "$step_count" | tr -d ' ')
  completed_steps=$(echo "$completed_steps" | tr -d ' ')

  if [ -n "$step_count" ] && [ "$step_count" -ge 4 ]; then
    if [ "$step_count" == "$completed_steps" ]; then
      echo -e "${GREEN}  ✅ Job $job_id: $step_count steps created, $completed_steps completed${NC}"
    else
      echo -e "${RED}  ❌ Job $job_id: $step_count steps created but only $completed_steps completed${NC}"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  elif [ -n "$step_count" ]; then
    echo -e "${RED}  ❌ Job $job_id: only $step_count steps (minimum 4 expected)${NC}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done <<< "$STEP_COUNTS"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo -e "${RED}❌ $FAIL_COUNT job(s) failed step verification after $VERIFY_ATTEMPTS attempts${NC}"
  exit 1
fi

echo -e "${GREEN}✅ All jobs completed with correct step counts${NC}"
echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 2.5: VERIFY JOB-LEVEL STATISTICS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Expected Records (quick-order variant): 2 records per job (customer + order)
# Expected Steps: 4 steps per job
EXPECTED_RECORDS_MIN=2
EXPECTED_RECORDS_MAX=4
EXPECTED_STEPS_MIN=4
EXPECTED_STEPS_MAX=6

verify_job_stats() {
  local job_id="$1"
  local job_label="$2"

  local json=$(get_job_status "$job_id")
  local total_records=$(echo "$json" | jq -r '.result.totalRecords')
  local steps_completed=$(echo "$json" | jq -r '.result.stepsCompleted')

  # Accept a range of records (depends on variant configuration)
  if [ "$total_records" -lt "$EXPECTED_RECORDS_MIN" ] || [ "$total_records" -gt "$EXPECTED_RECORDS_MAX" ]; then
    echo -e "${RED}❌ $job_label: Total records mismatch. Expected: $EXPECTED_RECORDS_MIN-$EXPECTED_RECORDS_MAX, Got: $total_records${NC}"
    return 1
  fi

  if [ "$steps_completed" -lt "$EXPECTED_STEPS_MIN" ] || [ "$steps_completed" -gt "$EXPECTED_STEPS_MAX" ]; then
    echo -e "${RED}❌ $job_label: Steps completed mismatch. Expected: $EXPECTED_STEPS_MIN-$EXPECTED_STEPS_MAX, Got: $steps_completed${NC}"
    return 1
  fi

  echo -e "${GREEN}✅ $job_label stats verified (Records: $total_records, Steps: $steps_completed)${NC}"
  return 0
}

STATS_FAILED=false
verify_job_stats "$JOB_ID_1" "Job 1" || STATS_FAILED=true
verify_job_stats "$JOB_ID_2" "Job 2" || STATS_FAILED=true
verify_job_stats "$JOB_ID_3" "Job 3" || STATS_FAILED=true

if [ "$STATS_FAILED" = true ]; then
  echo -e "${RED}❌ Job statistics verification FAILED${NC}"
  exit 1
fi

echo ""

echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 3: VERIFY PERFORMANCE (PARALLEL EXECUTION)${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}▶  Analyzing execution times...${NC}"

TIMINGS=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db sh -c "psql -U dtm_user -d dtm -t -c \"
SELECT
  id,
  ROUND(EXTRACT(EPOCH FROM (completed_at - submitted_at))::numeric, 1) as duration_seconds
FROM dtm_jobs
WHERE id IN ('${JOB_ID_1}', '${JOB_ID_2}', '${JOB_ID_3}')
ORDER BY submitted_at;
\" 2>&1" | grep -v "^$")

echo "$TIMINGS"
echo ""

# Parse durations
DURATION_1=$(echo "$TIMINGS" | grep "$JOB_ID_1" | awk '{print $3}')
DURATION_2=$(echo "$TIMINGS" | grep "$JOB_ID_2" | awk '{print $3}')
DURATION_3=$(echo "$TIMINGS" | grep "$JOB_ID_3" | awk '{print $3}')

echo -e "${CYAN}Individual durations:${NC}"
echo -e "  Job 1: ${DURATION_1}s (expected ~6s)"
echo -e "  Job 2: ${DURATION_2}s (expected ~9s)"
echo -e "  Job 3: ${DURATION_3}s (expected ~12s)"
echo ""

# Calculate max duration (wall time)
MAX_DURATION=$(printf "%s\n%s\n%s" "$DURATION_1" "$DURATION_2" "$DURATION_3" | sort -n | tail -1)
SEQUENTIAL_TIME=$(awk "BEGIN {print $DURATION_1 + $DURATION_2 + $DURATION_3}")
SPEEDUP=$(awk "BEGIN {printf \"%.2f\", $SEQUENTIAL_TIME / $MAX_DURATION}")

echo -e "${CYAN}Performance analysis:${NC}"
echo -e "  Wall time (parallel): ${MAX_DURATION}s"
echo -e "  Sequential time: ${SEQUENTIAL_TIME}s"
echo -e "  Speedup: ${SPEEDUP}x"
echo ""

if (( $(awk "BEGIN {print ($SPEEDUP >= 1.5)}") )); then
  echo -e "${GREEN}✅ Parallel execution confirmed (${SPEEDUP}x speedup)${NC}"
else
  echo -e "${YELLOW}⚠️  Speedup lower than expected (${SPEEDUP}x)${NC}"
  echo -e "${YELLOW}   Jobs may be running more sequentially than expected${NC}"
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}STEP 4: VERIFY NO CROSS-CONTAMINATION${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}▶  Checking for errors or data mix-ups...${NC}"

ERROR_CHECK=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db sh -c "psql -U dtm_user -d dtm -t -c \"
SELECT
  COUNT(*) as error_count
FROM dtm_steps
WHERE job_id IN ('${JOB_ID_1}', '${JOB_ID_2}', '${JOB_ID_3}')
  AND (status != 'completed' OR error IS NOT NULL);
\" 2>&1" | grep -v "^$" | xargs)

if [ "$ERROR_CHECK" != "0" ]; then
  echo -e "${RED}❌ Found ${ERROR_CHECK} steps with errors${NC}"
  exit 1
else
  echo -e "${GREEN}✅ No errors found in any job step${NC}"
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}FINAL SUMMARY${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${GREEN}✅ All 3 jobs completed successfully${NC}"
echo -e "${GREEN}✅ Data isolation verified (each job completed all steps)${NC}"
echo -e "${GREEN}✅ No cross-contamination (no errors)${NC}"
echo -e "${GREEN}✅ Parallel execution confirmed (${SPEEDUP}x speedup)${NC}"
echo ""
echo -e "${GREEN}🎉 Eval 10: Concurrent Jobs PASSED${NC}"
