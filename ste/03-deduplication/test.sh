#!/bin/bash

# ============================================================================
# E2E Eval: Deduplication Testing
# ============================================================================
# Tests the job request deduplication logic to ensure idempotency.
# Validates that duplicate requests are rejected with 409 Conflict.
# ============================================================================

set -e

# Source shared helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${REPO_ROOT}/workflows/order-processing/ste/shared/helpers.sh"

# Validate environment
validate_env_for_ste

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 E2E Eval: Deduplication Testing"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Test Plan:"
echo "  1. Submit first job request with enableDeduplication: true → Should succeed (201)"
echo "  2. Submit identical request → Should reject (409 Conflict)"
echo "  3. Submit different request → Should succeed (201)"
echo "  4. Wait for jobs to complete"
echo "  5. Submit same request again → Should reject (409 - still deduplicated)"
echo ""
echo "ℹ️  Note: This test uses per-request deduplication (enableDeduplication: true)"
echo "ℹ️        Global deduplication env var remains FALSE during development/testing"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Generate unique deduplication keys for this test run
DEDUP_KEY_1=$(uuidgen)
DEDUP_KEY_2=$(uuidgen)

echo "📝 Test Data:"
echo "   Deduplication Key 1: $DEDUP_KEY_1"
echo "   Deduplication Key 2: $DEDUP_KEY_2"
echo ""

# ============================================================================
# Pre-Test Cleanup: Remove any existing jobs for this deduplicationKey
# ============================================================================
# This eval tests deduplication, so we need a clean slate for this specific
# deduplicationKey to ensure the first request succeeds with 201 (not 409).
# We only delete jobs for THIS deduplicationKey, preserving other test data.
echo "🧹 Pre-test cleanup: Removing existing jobs for deduplicationKey $DEDUP_KEY_1..."
DELETED_COUNT=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db psql -U dtm_user -d dtm -t -c \
  "DELETE FROM dtm_jobs WHERE payload->>'deduplicationKey' = '$DEDUP_KEY_1' RETURNING id;" 2>/dev/null | grep -c "^" || echo "0")
if [ "$DELETED_COUNT" -gt 0 ]; then
  echo "   ✅ Cleaned up $DELETED_COUNT previous job(s) for deduplicationKey $DEDUP_KEY_1"
else
  echo "   ✅ No previous jobs found for deduplicationKey $DEDUP_KEY_1"
fi
echo ""

# ============================================================================
# Test 1: First Request - Should Succeed
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Test 1: First Request (Should Succeed)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PAYLOAD_1=$(cat <<EOF
{
  "deduplicationKey": "$DEDUP_KEY_1",
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "$DEDUP_KEY_1"
  },
  "enableDeduplication": true,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 2000 },
    "ValidateProduct": { "simDelay": 2000 },
    "SubmitCustomer": { "simDelay": 2000, "ackDelay": 1000 },
    "SubmitOrder": { "simDelay": 2000, "ackDelay": 1000 }
  }
}
EOF
)

echo "📤 Submitting first request..."
RESPONSE_1=$(curl -s -w "\n%{http_code}" -X POST \
  ${ORCHESTRATOR_HOST}/api/${API_VERSION}/workflows/order-processing/jobs \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_1")

HTTP_CODE_1=$(echo "$RESPONSE_1" | tail -n1)
RESPONSE_BODY_1=$(echo "$RESPONSE_1" | head -n-1)

if [ "$HTTP_CODE_1" != "201" ]; then
  echo "❌ FAILED: Expected HTTP 201, got $HTTP_CODE_1"
  echo "   Response: $RESPONSE_BODY_1"
  exit 1
fi

JOB_ID_1=$(echo "$RESPONSE_BODY_1" | jq -r '.jobId')
echo "✅ First request accepted"
echo "   Job ID: $JOB_ID_1"
echo "   HTTP Status: $HTTP_CODE_1"
echo ""
sleep 1

# ============================================================================
# Test 2: Duplicate Request - Should Reject
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Test 2: Duplicate Request (Should Reject with 409)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "📤 Submitting identical request..."
RESPONSE_2=$(curl -s -w "\n%{http_code}" -X POST \
  ${ORCHESTRATOR_HOST}/api/${API_VERSION}/workflows/order-processing/jobs \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_1")

HTTP_CODE_2=$(echo "$RESPONSE_2" | tail -n1)
RESPONSE_BODY_2=$(echo "$RESPONSE_2" | head -n-1)

if [ "$HTTP_CODE_2" != "409" ]; then
  echo "❌ FAILED: Expected HTTP 409 (Conflict), got $HTTP_CODE_2"
  echo "   Response: $RESPONSE_BODY_2"
  echo ""
  echo "   This indicates deduplication is not working correctly!"
  exit 1
fi

echo "✅ Duplicate request correctly rejected"
echo "   HTTP Status: $HTTP_CODE_2"
echo "   Response: $RESPONSE_BODY_2"
echo ""
sleep 1

# ============================================================================
# Test 3: Different Request - Should Succeed
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Test 3: Different Request (Should Succeed)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PAYLOAD_2=$(cat <<EOF
{
  "deduplicationKey": "$DEDUP_KEY_2",
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "$DEDUP_KEY_2"
  },
  "enableDeduplication": true,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 1000 },
    "ValidateProduct": { "simDelay": 1000 },
    "SubmitCustomer": { "simDelay": 1000, "ackDelay": 500 },
    "SubmitOrder": { "simDelay": 1000, "ackDelay": 500 }
  }
}
EOF
)

echo "📤 Submitting request with different deduplicationKey..."
RESPONSE_3=$(curl -s -w "\n%{http_code}" -X POST \
  ${ORCHESTRATOR_HOST}/api/${API_VERSION}/workflows/order-processing/jobs \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_2")

HTTP_CODE_3=$(echo "$RESPONSE_3" | tail -n1)
RESPONSE_BODY_3=$(echo "$RESPONSE_3" | head -n-1)

if [ "$HTTP_CODE_3" != "201" ]; then
  echo "❌ FAILED: Expected HTTP 201, got $HTTP_CODE_3"
  echo "   Response: $RESPONSE_BODY_3"
  exit 1
fi

JOB_ID_2=$(echo "$RESPONSE_BODY_3" | jq -r '.jobId')
echo "✅ Different request accepted"
echo "   Job ID: $JOB_ID_2"
echo "   HTTP Status: $HTTP_CODE_3"
echo ""

# ============================================================================
# Test 4: Wait for First Job to Complete
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Test 4: Wait for Jobs to Complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "⏳ Waiting for first job ($JOB_ID_1) to complete..."
poll_job "$JOB_ID_1" 60

FINAL_STATUS_1_JSON=$(get_job_status "$JOB_ID_1")
FINAL_STATUS_1=$(extract_job_status "$FINAL_STATUS_1_JSON")
echo "   Final Status: $FINAL_STATUS_1"

if [ "$FINAL_STATUS_1" != "completed" ]; then
  echo "❌ FAILED: First job did not complete successfully"
  echo "   Final status: $FINAL_STATUS_1"
  exit 1
fi

echo "✅ First job completed"
echo ""

echo "⏳ Waiting for second job ($JOB_ID_2) to complete..."
poll_job "$JOB_ID_2" 40

FINAL_STATUS_2_JSON=$(get_job_status "$JOB_ID_2")
FINAL_STATUS_2=$(extract_job_status "$FINAL_STATUS_2_JSON")
echo "   Final Status: $FINAL_STATUS_2"

if [ "$FINAL_STATUS_2" != "completed" ]; then
  echo "❌ FAILED: Second job did not complete successfully"
  echo "   Final status: $FINAL_STATUS_2"
  exit 1
fi

echo "✅ Second job completed"
echo ""

# ============================================================================
# Job-Level Statistics Verification
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Verifying Job-Level Statistics"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Expected: 2 Records (quick-order variant)
# Expected: 4 Steps (ValidateCustomer, ValidateProduct, SubmitCustomer, SubmitOrder)
EXPECTED_RECORDS=2
EXPECTED_STEPS=4

verify_job_stats() {
  local job_id="$1"
  local job_label="$2"

  local json=$(get_job_status "$job_id")
  local total_records=$(echo "$json" | jq -r '.result.totalRecords')
  local steps_completed=$(echo "$json" | jq -r '.result.stepsCompleted')

  echo "   Checking $job_label ($job_id)..."

  if [ "$total_records" == "$EXPECTED_RECORDS" ]; then
    echo "   ✅ Total records processed: $total_records"
  else
    echo "   ❌ Total records processed mismatch. Expected: $EXPECTED_RECORDS, Got: $total_records"
    return 1
  fi

  if [ "$steps_completed" == "$EXPECTED_STEPS" ]; then
    echo "   ✅ Steps completed: $steps_completed"
  else
    echo "   ❌ Steps completed mismatch. Expected: $EXPECTED_STEPS, Got: $steps_completed"
    return 1
  fi
  echo ""
}

if ! verify_job_stats "$JOB_ID_1" "Job 1"; then
  echo "❌ Stats verification failed for Job 1"
  exit 1
fi

if ! verify_job_stats "$JOB_ID_2" "Job 2"; then
  echo "❌ Stats verification failed for Job 2"
  exit 1
fi

# ============================================================================
# Test 5: Retry After Completion - Should Still Reject
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Test 5: Retry After Completion (Should Still Reject)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "📤 Submitting first request again (after completion, same deduplicationKey)..."
RESPONSE_4=$(curl -s -w "\n%{http_code}" -X POST \
  ${ORCHESTRATOR_HOST}/api/${API_VERSION}/workflows/order-processing/jobs \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_1")

HTTP_CODE_4=$(echo "$RESPONSE_4" | tail -n1)
RESPONSE_BODY_4=$(echo "$RESPONSE_4" | head -n-1)

if [ "$HTTP_CODE_4" != "409" ]; then
  echo "❌ FAILED: Expected HTTP 409 (Conflict), got $HTTP_CODE_4"
  echo "   Response: $RESPONSE_BODY_4"
  echo ""
  echo "   Deduplication should persist even after job completes!"
  exit 1
fi

echo "✅ Duplicate request still correctly rejected after completion"
echo "   HTTP Status: $HTTP_CODE_4"
echo ""

# ============================================================================
# Final Summary
# ============================================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ALL TESTS PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Summary:"
echo "   ✅ First request accepted (201)"
echo "   ✅ Duplicate request rejected (409)"
echo "   ✅ Different deduplicationKey accepted (201)"
echo "   ✅ Both jobs completed successfully"
echo "   ✅ Retry after completion still rejected (409)"
echo ""
echo "🎯 Deduplication Logic: WORKING CORRECTLY"
echo ""
echo "📝 Job IDs for review:"
echo "   Job 1 (deduplicationKey: $DEDUP_KEY_1): $JOB_ID_1"
echo "   Job 2 (deduplicationKey: $DEDUP_KEY_2): $JOB_ID_2"
echo ""
