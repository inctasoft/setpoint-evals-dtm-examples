#!/bin/bash

# LocalStack Status Check Script
# Displays the status of LocalStack resources

set -e

echo "=========================================="
echo "📊 LocalStack Status Check"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if LocalStack is running
echo -e "${BLUE}Checking LocalStack health...${NC}"
if curl -sf http://localhost:${LOCALSTACK_PORT:-4567}/_localstack/health > /dev/null 2>&1; then
  echo -e "${GREEN}✅ LocalStack is running${NC}"
else
  echo -e "${RED}❌ LocalStack is not running${NC}"
  echo ""
  echo "Start LocalStack with:"
  echo "  cd dtm"
  echo "  docker compose -f docker compose.localstack.yml up -d localstack"
  exit 1
fi

echo ""

# Get LocalStack health details
echo -e "${BLUE}Service Status:${NC}"
HEALTH=$(curl -s http://localhost:${LOCALSTACK_PORT:-4567}/_localstack/health)
echo "${HEALTH}" | jq '.'

echo ""

# List SQS queues
echo -e "${BLUE}SQS Queues:${NC}"
echo "=========================================="

export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1

QUEUES=$(aws --endpoint-url=http://localhost:${LOCALSTACK_PORT:-4567} sqs list-queues 2>/dev/null || echo '{}')

if echo "${QUEUES}" | jq -e '.QueueUrls' > /dev/null 2>&1; then
  echo "${QUEUES}" | jq -r '.QueueUrls[]' | while read -r queue_url; do
    QUEUE_NAME=$(echo "${queue_url}" | awk -F'/' '{print $NF}')
    
    # Get queue attributes
    ATTRS=$(aws --endpoint-url=http://localhost:${LOCALSTACK_PORT:-4567} sqs get-queue-attributes \
      --queue-url "${queue_url}" \
      --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
      2>/dev/null || echo '{}')
    
    MSG_COUNT=$(echo "${ATTRS}" | jq -r '.Attributes.ApproximateNumberOfMessages // "0"')
    IN_FLIGHT=$(echo "${ATTRS}" | jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible // "0"')
    
    echo ""
    echo "Queue: ${QUEUE_NAME}"
    echo "  URL: ${queue_url}"
    echo "  Messages: ${MSG_COUNT}"
    echo "  In-flight: ${IN_FLIGHT}"
    
    if [ "${MSG_COUNT}" -gt 0 ]; then
      echo -e "  ${YELLOW}⚠️  Has ${MSG_COUNT} message(s) waiting${NC}"
    else
      echo -e "  ${GREEN}✅ Empty${NC}"
    fi
  done
else
  echo -e "${YELLOW}No queues found${NC}"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}✅ Status check complete${NC}"
echo "=========================================="
echo ""

