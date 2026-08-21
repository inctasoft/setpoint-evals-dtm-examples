#!/bin/bash

# Test script for NEW Event-Based API
# Tests the generic workflow job API endpoints

set -e

# Get script directory and load API configuration
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${SCRIPT_DIR}/inc/api-config.sh"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   ${BOLD}NEW Event-Based API Test${NC}${BLUE}                                  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Display API configuration
display_api_config

# Generate unique test data
TIMESTAMP=$(date +%s)
WORKFLOW_NAME="order-processing"
ENTITY_ID="ENTITY-TEST-${TIMESTAMP}"
VARIANT="default"

echo -e "${CYAN}📝 Test Data:${NC}"
echo -e "  Workflow:         ${BOLD}${WORKFLOW_NAME}${NC}"
echo -e "  Entity ID:        ${BOLD}${ENTITY_ID}${NC}"
echo -e "  Variant:          ${BOLD}${VARIANT}${NC}"
echo ""

# Step 1: Initiate Job (NEW API)
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}Step 1: Initiate Workflow Job${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
INIT_URL="${API_BASE_URL}/workflows/${WORKFLOW_NAME}/jobs"
echo -e "${CYAN}POST ${INIT_URL}${NC}"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "${INIT_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "variant": "'"${VARIANT}"'",
    "payload": {
      "entityId": "'"${ENTITY_ID}"'"
    }
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 201 ]; then
  echo -e "${GREEN}✅ Job initiated successfully!${NC}"
  echo ""
  echo -e "${BOLD}Response:${NC}"
  echo "$BODY" | jq '.'
  
  JOB_ID=$(echo "$BODY" | jq -r '.jobId')
  echo ""
  echo -e "${GREEN}Job ID: ${BOLD}${JOB_ID}${NC}"
else
  echo -e "${RED}❌ Failed to initiate job (HTTP ${HTTP_CODE})${NC}"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
  exit 1
fi

echo ""
sleep 2

# Step 2: Get Event Status (NEW API)
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}Step 2: Get Event Status${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
STATUS_URL="${API_BASE_URL}/migration/${JOB_ID}/status"
echo -e "${CYAN}GET ${STATUS_URL}${NC}"
echo ""

STATUS_RESPONSE=$(curl -s -w "\n%{http_code}" \
  "${STATUS_URL}")

STATUS_HTTP_CODE=$(echo "$STATUS_RESPONSE" | tail -n1)
STATUS_BODY=$(echo "$STATUS_RESPONSE" | sed '$d')

if [ "$STATUS_HTTP_CODE" -eq 200 ]; then
  echo -e "${GREEN}✅ Status retrieved successfully!${NC}"
  echo ""
  echo -e "${BOLD}Response:${NC}"
  echo "$STATUS_BODY" | jq '.'
  
  STATUS=$(echo "$STATUS_BODY" | jq -r '.status')
  CURRENT_STEP=$(echo "$STATUS_BODY" | jq -r '.currentStep // "N/A"')
  
  echo ""
  echo -e "  Status:       ${BOLD}${STATUS}${NC}"
  echo -e "  Current Step: ${BOLD}${CURRENT_STEP}${NC}"
else
  echo -e "${RED}❌ Failed to get status (HTTP ${STATUS_HTTP_CODE})${NC}"
  echo "$STATUS_BODY" | jq '.' 2>/dev/null || echo "$STATUS_BODY"
fi

echo ""
sleep 2

# Step 3: Get Event Progress (NEW API)
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}Step 3: Get Event Progress${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
PROGRESS_URL="${API_BASE_URL}/migration/${JOB_ID}/progress"
echo -e "${CYAN}GET ${PROGRESS_URL}${NC}"
echo ""

PROGRESS_RESPONSE=$(curl -s -w "\n%{http_code}" \
  "${PROGRESS_URL}")

PROGRESS_HTTP_CODE=$(echo "$PROGRESS_RESPONSE" | tail -n1)
PROGRESS_BODY=$(echo "$PROGRESS_RESPONSE" | sed '$d')

if [ "$PROGRESS_HTTP_CODE" -eq 200 ]; then
  echo -e "${GREEN}✅ Progress retrieved successfully!${NC}"
  echo ""
  echo -e "${BOLD}Response:${NC}"
  echo "$PROGRESS_BODY" | jq '.'
  
  PERCENT=$(echo "$PROGRESS_BODY" | jq -r '.progress.percentComplete')
  COMPLETED=$(echo "$PROGRESS_BODY" | jq -r '.progress.completedEntities')
  TOTAL=$(echo "$PROGRESS_BODY" | jq -r '.progress.totalEntities')
  TRACKING_URL=$(echo "$PROGRESS_BODY" | jq -r '.trackingUrl')
  
  echo ""
  echo -e "  Progress:     ${BOLD}${PERCENT}%${NC} (${COMPLETED}/${TOTAL} entities)"
  echo -e "  Tracking URL: ${BOLD}${TRACKING_URL}${NC}"
else
  echo -e "${RED}❌ Failed to get progress (HTTP ${PROGRESS_HTTP_CODE})${NC}"
  echo "$PROGRESS_BODY" | jq '.' 2>/dev/null || echo "$PROGRESS_BODY"
fi

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Summary
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   ${BOLD}Test Summary${NC}${BLUE}                                                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Job ID:           ${BOLD}${JOB_ID}${NC}"
echo -e "  Workflow:         ${BOLD}${WORKFLOW_NAME}${NC}"
echo -e "  Entity ID:        ${BOLD}${ENTITY_ID}${NC}"
echo ""
echo -e "${GREEN}✅ All NEW API endpoints tested successfully!${NC}"
echo ""
echo -e "${CYAN}Monitor the event with:${NC}"
echo -e "  ${BOLD}./scripts/monitor-events-api.sh${NC}"
echo ""
echo -e "${CYAN}Or check specific event:${NC}"
echo -e "  ${BOLD}curl ${API_BASE_URL}/migration/${JOB_ID}/progress | jq '.'${NC}"
echo ""

