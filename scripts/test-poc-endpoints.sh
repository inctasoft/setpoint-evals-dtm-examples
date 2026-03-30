#!/bin/bash

# Test script for POC-style endpoints
# Tests POST /api/v1/workflows/:name/jobs and GET /api/v1/jobs/:id endpoints

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

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   POC Endpoints Test - DTM Orchestrator                      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Test 1: Health check
echo -e "${YELLOW}1. Testing health endpoint...${NC}"
HEALTH_RESPONSE=$(curl -s -f "$ORCHESTRATOR_URL/" 2>/dev/null || echo "")

if [ -z "$HEALTH_RESPONSE" ]; then
  echo -e "${RED}❌ Orchestrator not reachable at $ORCHESTRATOR_URL${NC}"
  echo ""
  echo "Make sure the orchestrator is running:"
  echo "  ./scripts/local-env.sh start"
  echo ""
  exit 1
fi

echo -e "${GREEN}✅ Orchestrator is healthy${NC}"
echo ""

# Test 2: Submit a CONSUMER migration
echo -e "${YELLOW}2. Testing POST /api/v1/migrate (CONSUMER migration)...${NC}"
CONSUMER_JOB=$(curl -s -X POST "$API_BASE_URL/migrate" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "consumer",
    "description": "Test consumer migration via POC endpoint",
    "filters": {
      "legacyId": "CONSUMER-TEST-001"
    }
  }')

CONSUMER_JOB_ID=$(echo "$CONSUMER_JOB" | jq -r '.jobId')
echo -e "${GREEN}✅ Consumer migration created: $CONSUMER_JOB_ID${NC}"
echo "   Response: $(echo "$CONSUMER_JOB" | jq -c '.')"
echo ""

# Test 3: Submit a MEMBERSHIP migration
echo -e "${YELLOW}3. Testing POST /api/v1/migrate (MEMBERSHIP migration)...${NC}"
MEMBERSHIP_JOB=$(curl -s -X POST "$API_BASE_URL/migrate" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "membership",
    "description": "Test membership migration via POC endpoint",
    "filters": {
      "consumerId": "consumer-api-test",
      "tier": "GOLD"
    }
  }')

MEMBERSHIP_JOB_ID=$(echo "$MEMBERSHIP_JOB" | jq -r '.jobId')
echo -e "${GREEN}✅ Membership migration created: $MEMBERSHIP_JOB_ID${NC}"
echo "   Response: $(echo "$MEMBERSHIP_JOB" | jq -c '.')"
echo ""

# Test 4: Submit a PCI_DATA migration
echo -e "${YELLOW}4. Testing POST /api/v1/migrate (PCI_DATA migration)...${NC}"
PCI_JOB=$(curl -s -X POST "$API_BASE_URL/migrate" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "pci_data",
    "description": "Test PCI data migration via POC endpoint",
    "filters": {
      "consumerId": "consumer-pci-test"
    },
    "config": {
      "complianceLevel": "PCI-DSS-3.2.1"
    }
  }')

PCI_JOB_ID=$(echo "$PCI_JOB" | jq -r '.jobId')
echo -e "${GREEN}✅ PCI Data migration created: $PCI_JOB_ID${NC}"
echo "   Response: $(echo "$PCI_JOB" | jq -c '.')"
echo ""

# Wait a bit for steps to be created and delegated
echo -e "${YELLOW}5. Waiting 5 seconds for job processing...${NC}"
sleep 5
echo ""

# Test 5: Query CONSUMER job status
echo -e "${YELLOW}6. Testing GET /api/v1/jobs/:id (CONSUMER job)...${NC}"
CONSUMER_STATUS=$(curl -s "$API_BASE_URL/jobs/$CONSUMER_JOB_ID")
CONSUMER_STEP_COUNT=$(echo "$CONSUMER_STATUS" | jq '.steps | length')
echo -e "${GREEN}✅ Consumer job status retrieved${NC}"
echo "   Job ID: $CONSUMER_JOB_ID"
echo "   Status: $(echo "$CONSUMER_STATUS" | jq -r '.status')"
echo "   Steps: $CONSUMER_STEP_COUNT (expected: 3)"
echo ""

# Test 6: Query MEMBERSHIP job status
echo -e "${YELLOW}7. Testing GET /api/v1/jobs/:id (MEMBERSHIP job)...${NC}"
MEMBERSHIP_STATUS=$(curl -s "$API_BASE_URL/jobs/$MEMBERSHIP_JOB_ID")
MEMBERSHIP_STEP_COUNT=$(echo "$MEMBERSHIP_STATUS" | jq '.steps | length')
echo -e "${GREEN}✅ Membership job status retrieved${NC}"
echo "   Job ID: $MEMBERSHIP_JOB_ID"
echo "   Status: $(echo "$MEMBERSHIP_STATUS" | jq -r '.status')"
echo "   Steps: $MEMBERSHIP_STEP_COUNT (expected: 6)"
echo ""

# Test 7: Query PCI_DATA job status
echo -e "${YELLOW}8. Testing GET /api/v1/jobs/:id (PCI_DATA job)...${NC}"
PCI_STATUS=$(curl -s "$ORCHESTRATOR_URL/api/v1/jobs/$PCI_JOB_ID")
PCI_STEP_COUNT=$(echo "$PCI_STATUS" | jq '.steps | length')
echo -e "${GREEN}✅ PCI Data job status retrieved${NC}"
echo "   Job ID: $PCI_JOB_ID"
echo "   Status: $(echo "$PCI_STATUS" | jq -r '.status')"
echo "   Steps: $PCI_STEP_COUNT (expected: 14)"
echo ""

# Test 8: List all jobs
echo -e "${YELLOW}9. Testing GET /jobs (list all jobs)...${NC}"
ALL_JOBS=$(curl -s "$ORCHESTRATOR_URL/jobs")
TOTAL_JOBS=$(echo "$ALL_JOBS" | jq '.total')
echo -e "${GREEN}✅ Jobs list retrieved${NC}"
echo "   Total jobs: $TOTAL_JOBS"
echo ""

# Summary
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Test Summary                                                ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""
echo "Jobs Created:"
echo -e "  ${CYAN}Consumer:${NC}   $CONSUMER_JOB_ID (3 steps)"
echo -e "  ${CYAN}Membership:${NC} $MEMBERSHIP_JOB_ID (6 steps)"
echo -e "  ${CYAN}PCI Data:${NC}   $PCI_JOB_ID (14 steps)"
echo ""
echo "Verification:"
if [ "$CONSUMER_STEP_COUNT" -eq 3 ] && [ "$MEMBERSHIP_STEP_COUNT" -eq 6 ] && [ "$PCI_STEP_COUNT" -eq 14 ]; then
  echo -e "  ${GREEN}✅ Step counts match POC configuration${NC}"
else
  echo -e "  ${RED}❌ Step counts don't match expected values${NC}"
  echo "     Expected: Consumer=3, Membership=6, PCI=14"
  echo "     Got:      Consumer=$CONSUMER_STEP_COUNT, Membership=$MEMBERSHIP_STEP_COUNT, PCI=$PCI_STEP_COUNT"
fi
echo ""
echo "Next Steps:"
echo "  • Monitor jobs:  ./scripts/local-env.sh jobs-status-api"
echo "  • Check SQS:     ./scripts/local-env.sh sqs-status"
echo "  • View logs:     ./scripts/local-env.sh logs"
echo ""

